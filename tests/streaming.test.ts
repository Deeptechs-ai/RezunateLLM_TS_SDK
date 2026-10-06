/**
 * Tests for streaming: chunk models, the shared stream engine and every provider's stream.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete } from "../src/rezunateLlmSdk/gateway";
import {
  type ChatCompletionChunk,
  ChatCompletionChunkSchema,
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
  ChoiceChunkSchema,
  type Provider,
} from "../src/rezunateLlmSdk/models";
import { getProvider } from "../src/rezunateLlmSdk/providers";
import {
  BaseProvider,
  type StreamRequest,
  type StreamState,
} from "../src/rezunateLlmSdk/providers/base";
import { mockApiKey, mockStreamFetch, sseData, sseEvent } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) {
    result.push(item);
  }
  return result;
}

function hiRequest(model = "test-model"): ChatCompletionRequest {
  return ChatCompletionRequestSchema.parse({
    model,
    messages: [{ role: "user", content: "Hi" }],
    stream: true,
  });
}

const URL = "https://api.test.com/v1/stream";

/** A provider with only the required members; it keeps the default stream hooks. */
class NoStreamProvider extends BaseProvider {
  get baseUrl(): string {
    return "https://api.test.com/v1";
  }

  get providerName(): Provider {
    return "test_provider" as Provider;
  }

  getHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  getEndpoint(): string {
    return "/stream";
  }

  transformRequest(request: ChatCompletionRequest): unknown {
    return request;
  }

  transformResponse(): ChatCompletionResponse {
    throw new Error("not used");
  }
}

/** A provider whose frames are `{text?, finish?, usage?}` and whose stream ends with "[DONE]". */
class TestStreamProvider extends NoStreamProvider {
  protected override buildStreamRequest(request: ChatCompletionRequest): StreamRequest {
    return { url: URL, body: { ...request, extra: null }, headers: this.getHeaders() };
  }

  protected override translateFrame(
    _event: string,
    data: string,
    state: StreamState,
  ): ChatCompletionChunk | null {
    const frame = BaseProvider.parseJsonFrame(data) as {
      text?: string;
      finish?: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    } | null;
    if (!frame || (frame.text === undefined && frame.finish === undefined)) {
      return null;
    }
    return this.makeChunk(state, {
      delta: frame.text === undefined ? {} : { content: frame.text },
      finishReason: frame.finish ?? null,
      usage: frame.usage ?? null,
    });
  }

  protected override isStreamTerminator(_event: string, data: string): boolean {
    return data === "[DONE]";
  }

  static parseJson(data: string): unknown {
    return BaseProvider.parseJsonFrame(data);
  }
}

function provider(options: { maxRetries?: number; timeout?: number } = {}) {
  return new TestStreamProvider({ apiKey: mockApiKey, retryDelay: 0.01, ...options });
}

const DONE = "data: [DONE]\n\n";

describe("chunk models", () => {
  it("fills in defaults for an empty chunk", () => {
    expect(ChatCompletionChunkSchema.parse({})).toEqual({
      id: null,
      object: "chat.completion.chunk",
      created: 0,
      model: null,
      choices: [],
      usage: null,
      provider: null,
      error: null,
    });
  });

  it("fills in defaults for an empty choice", () => {
    expect(ChoiceChunkSchema.parse({})).toEqual({
      index: 0,
      delta: { role: null, content: null },
      finish_reason: null,
      provider_finish_reason: null,
    });
  });

  it("parses a full chunk", () => {
    const chunk = ChatCompletionChunkSchema.parse({
      id: "chatcmpl-1",
      created: 1700000000,
      model: "gpt-4",
      choices: [
        {
          delta: { content: "Hi" },
          finish_reason: "stop",
          provider_finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      provider: "openai",
    });

    expect(chunk.choices[0]?.delta).toEqual({ role: null, content: "Hi" });
    expect(chunk.choices[0]?.finish_reason).toBe("stop");
    expect(chunk.usage?.total_tokens).toBe(4);
  });

  it("rejects a finish reason outside the OpenAI list", () => {
    expect(() => ChoiceChunkSchema.parse({ finish_reason: "end_turn" })).toThrow();
  });
});

describe("stream engine", () => {
  it("translates each frame into a chunk and stops at the terminator", async () => {
    mockStreamFetch({
      pieces: [sseData({ text: "Hel" }, { text: "lo" }), DONE, sseData({ text: "after" })],
    });

    const chunks = await collect(provider().stream(hiRequest()));

    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(["Hel", "lo"]);
  });

  it("skips frames the provider does not translate", async () => {
    mockStreamFetch({
      pieces: [sseData({ ping: true }), ": comment\n\n", sseData({ text: "Hi" }), DONE],
    });

    const chunks = await collect(provider().stream(hiRequest()));

    expect(chunks).toHaveLength(1);
  });

  it("gives every chunk the same id, created, model and provider", async () => {
    mockStreamFetch({ pieces: [sseData({ text: "a" }, { text: "b" }), DONE] });

    const [first, second] = await collect(provider().stream(hiRequest("my-model")));

    expect(first?.id).toMatch(/^chatcmpl-[0-9a-f]{8}$/);
    expect(second?.id).toBe(first?.id);
    expect(second?.created).toBe(first?.created);
    expect(first?.model).toBe("my-model");
    expect(first?.provider).toBe("test_provider");
    expect(first?.object).toBe("chat.completion.chunk");
    expect(first?.error).toBeNull();
  });

  it.each([
    ["end_turn", "stop"],
    ["max_tokens", "length"],
    ["SAFETY", "content_filter"],
    ["something_new", "stop"],
  ])("maps finish reason %s to %s and keeps the original", async (original, mapped) => {
    mockStreamFetch({ pieces: [sseData({ finish: original }), DONE] });

    const [chunk] = await collect(provider().stream(hiRequest()));

    expect(chunk?.choices[0]?.finish_reason).toBe(mapped);
    expect(chunk?.choices[0]?.provider_finish_reason).toBe(original);
  });

  it("leaves both finish fields null on text chunks", async () => {
    mockStreamFetch({ pieces: [sseData({ text: "Hi" }), DONE] });

    const [chunk] = await collect(provider().stream(hiRequest()));

    expect(chunk?.choices[0]?.finish_reason).toBeNull();
    expect(chunk?.choices[0]?.provider_finish_reason).toBeNull();
    expect(chunk?.usage).toBeNull();
  });

  it("passes usage through", async () => {
    const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
    mockStreamFetch({ pieces: [sseData({ finish: "stop", usage }), DONE] });

    const [chunk] = await collect(provider().stream(hiRequest()));

    expect(chunk?.usage).toEqual(usage);
  });

  it("POSTs the JSON body without null values", async () => {
    const fetch = mockStreamFetch({ pieces: [DONE] });

    await collect(provider().stream(hiRequest()));

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: `Bearer ${mockApiKey}` });
    const body = JSON.parse(String(init?.body));
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty("extra");
    expect(body).not.toHaveProperty("temperature");
  });

  it("ends normally when the body ends without a terminator", async () => {
    mockStreamFetch({ pieces: [sseData({ text: "Hi" })] });

    const chunks = await collect(provider().stream(hiRequest()));

    expect(chunks.map((c) => c.error)).toEqual([null]);
  });

  it("closes the connection when the caller stops early", async () => {
    const onCancel = vi.fn();
    mockStreamFetch({
      pieces: [sseData({ text: "a" }), sseData({ text: "b" })],
      hang: true,
      onCancel,
    });

    for await (const _chunk of provider().stream(hiRequest())) {
      break;
    }

    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("stream start is retried", () => {
  it("retries a rate limit (429) and then streams", async () => {
    const fetch = mockStreamFetch({ status: 429 }, { pieces: [sseData({ text: "Hi" }), DONE] });

    const chunks = await collect(provider().stream(hiRequest()));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(["Hi"]);
  });

  it("retries a network failure and then streams", async () => {
    const fetch = mockStreamFetch(
      { throws: new TypeError("fetch failed") },
      { pieces: [sseData({ text: "Hi" }), DONE] },
    );

    const chunks = await collect(provider().stream(hiRequest()));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(1);
  });

  it("gives up after maxRetries with one error chunk", async () => {
    const fetch = mockStreamFetch({ status: 503 }, { status: 503 }, { status: 503 });

    const chunks = await collect(provider({ maxRetries: 2 }).stream(hiRequest("my-model")));

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      id: null,
      object: "chat.completion.chunk",
      model: "my-model",
      choices: [],
      provider: "test_provider",
      error: { type: "api_error", code: 503, retries_attempted: 2 },
    });
  });

  it("does not retry a client error (400)", async () => {
    const fetch = mockStreamFetch({ status: 400 });

    const chunks = await collect(provider().stream(hiRequest()));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(chunks[0]?.error).toMatchObject({ code: 400, retries_attempted: 0 });
  });
});

describe("stream failures after the start", () => {
  it("keeps the chunks already sent and ends with an error chunk, without retrying", async () => {
    const fetch = mockStreamFetch({
      pieces: [sseData({ text: "Hel" }), new TypeError("fetch failed")],
    });

    const chunks = await collect(provider().stream(hiRequest()));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(chunks.map((c) => c.choices[0]?.delta.content ?? null)).toEqual(["Hel", null]);
    expect(chunks[1]?.error?.message).toBe("fetch failed");
  });

  it("ends with a timeout error chunk when the stream goes silent", async () => {
    mockStreamFetch({ pieces: [sseData({ text: "Hi" })], hang: true });

    const chunks = await collect(provider({ timeout: 0.05 }).stream(hiRequest()));

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.error?.message).toContain("timeout");
  });

  it("does not cut off a stream that keeps sending data", async () => {
    const frame = sseData({ text: "." });
    mockStreamFetch({ pieces: [frame, 40, frame, 40, frame, 40, frame, DONE] });

    const chunks = await collect(provider({ timeout: 0.1 }).stream(hiRequest()));

    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.error === null)).toBe(true);
  });

  it("reports a provider without stream support as an error chunk", async () => {
    const fetch = mockStreamFetch();

    const chunks = await collect(new NoStreamProvider({ apiKey: mockApiKey }).stream(hiRequest()));

    expect(fetch).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error?.message).toBe(
      "NoStreamProvider does not implement buildStreamRequest",
    );
  });
});

describe("parseJsonFrame", () => {
  it.each([
    ["", null],
    ["not json", null],
    ['{"a":1}', { a: 1 }],
  ])("parses %j", (data, expected) => {
    expect(TestStreamProvider.parseJson(data)).toEqual(expected);
  });
});

/** One chunk in the OpenAI streaming format, as the providers send it. */
function sdkChunk(delta: object, finishReason: string | null = null, extra: object = {}) {
  return {
    id: "chatcmpl-abc",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "the-model",
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    ...extra,
  };
}

const helloStream = [
  sseData(
    sdkChunk({ role: "assistant", content: "" }),
    sdkChunk({ content: "Hello" }),
    sdkChunk({}, "stop"),
  ),
  DONE,
];

function streamingProvider(name: string, maxRetries = 3) {
  return getProvider(name, mockApiKey, { retryDelay: 0.01, maxRetries });
}

describe.each([
  ["openai", "gpt-4", "https://api.openai.com/v1/chat/completions"],
  ["grok", "grok-3-mini", "https://api.x.ai/v1/chat/completions"],
  ["deepseek", "deepseek-chat", "https://api.deepseek.com/v1/chat/completions"],
  ["meta", "muse-spark-1.3", "https://api.meta.ai/v1/chat/completions"],
])("%s streaming (OpenAI-compatible)", (name, model, url) => {
  it("yields the provider's chunks in our format", async () => {
    mockStreamFetch({ pieces: helloStream });

    const chunks = await collect(streamingProvider(name).stream(hiRequest(model)));

    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(["", "Hello", null]);
    expect(chunks[0]?.choices[0]?.delta.role).toBe("assistant");
    expect(chunks[2]?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks[2]?.choices[0]?.provider_finish_reason).toBe("stop");
    expect(chunks.every((c) => c.id === "chatcmpl-abc" && c.provider === name)).toBe(true);
  });

  it("POSTs stream: true to the chat endpoint", async () => {
    const fetch = mockStreamFetch({ pieces: helloStream });

    await collect(streamingProvider(name).stream(hiRequest(model)));

    const [sentUrl, init] = fetch.mock.calls[0] ?? [];
    expect(String(sentUrl)).toBe(url);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model, stream: true });
    expect(body).not.toHaveProperty("temperature");
  });

  it("retries the start of the stream", async () => {
    const fetch = mockStreamFetch({ status: 429 }, { pieces: helloStream });

    const chunks = await collect(streamingProvider(name).stream(hiRequest(model)));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(3);
  });

  it("gives up after maxRetries with one error chunk", async () => {
    const fetch = mockStreamFetch({ status: 429 }, { status: 429 });

    const chunks = await collect(streamingProvider(name, 1).stream(hiRequest(model)));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      model,
      provider: name,
      choices: [],
      error: { code: 429, retries_attempted: 1 },
    });
  });
});

describe("OpenAI-compatible stream details", () => {
  it("maps a provider-only finish reason and keeps the original", async () => {
    mockStreamFetch({ pieces: [sseData(sdkChunk({}, "insufficient_system_resource")), DONE] });

    const [chunk] = await collect(streamingProvider("deepseek").stream(hiRequest("deepseek-chat")));

    expect(chunk?.choices[0]?.finish_reason).toBe("stop");
    expect(chunk?.choices[0]?.provider_finish_reason).toBe("insufficient_system_resource");
  });

  it("drops fields our chunk model does not have", async () => {
    mockStreamFetch({
      pieces: [
        sseData(sdkChunk({ content: "Hi", refusal: null }, null, { system_fingerprint: "fp" })),
        DONE,
      ],
    });

    const [chunk] = await collect(streamingProvider("openai").stream(hiRequest("gpt-4")));

    expect(chunk).not.toHaveProperty("system_fingerprint");
    expect(chunk?.choices[0]).not.toHaveProperty("logprobs");
    expect(chunk?.choices[0]?.delta).toEqual({ role: null, content: "Hi" });
  });

  it("passes the final usage chunk through", async () => {
    const usage = { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 };
    mockStreamFetch({
      pieces: [sseData({ ...sdkChunk({}), choices: [], usage }), DONE],
    });

    const [chunk] = await collect(streamingProvider("openai").stream(hiRequest("gpt-4")));

    expect(chunk?.choices).toEqual([]);
    expect(chunk?.usage).toEqual(usage);
  });

  it("ends with an error chunk when the stream breaks, without retrying", async () => {
    const fetch = mockStreamFetch({
      pieces: [sseData(sdkChunk({ content: "Hel" })), new TypeError("fetch failed")],
    });

    const chunks = await collect(streamingProvider("openai").stream(hiRequest("gpt-4")));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.choices[0]?.delta.content).toBe("Hel");
    expect(chunks[1]?.error).not.toBeNull();
  });
});

describe("chatComplete with stream: true", () => {
  const streamRequest = {
    model: "gpt-4",
    messages: [{ role: "user" as const, content: "Hi" }],
    stream: true as const,
  };

  it("returns the provider's chunks", async () => {
    mockStreamFetch({ pieces: helloStream });

    const chunks = await collect(
      chatComplete({ provider: "openai", apiKey: mockApiKey, request: streamRequest }),
    );

    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(["", "Hello", null]);
  });

  it("reports an unknown provider as an error chunk", async () => {
    const fetch = mockStreamFetch();

    const chunks = await collect(
      chatComplete({ provider: "nope", apiKey: mockApiKey, request: streamRequest }),
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ model: "gpt-4", provider: null, choices: [] });
    expect(chunks[0]?.error?.message).toContain("nope");
  });

  it("reports an invalid request as an error chunk", async () => {
    const fetch = mockStreamFetch();
    const request = { ...streamRequest, messages: [{ role: "robot", content: "Hi" }] } as never;

    const chunks = await collect(chatComplete({ provider: "openai", apiKey: mockApiKey, request }));

    expect(fetch).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error).not.toBeNull();
  });

  it("reports a provider error as an error chunk", async () => {
    mockStreamFetch({ status: 401 });

    const chunks = await collect(
      chatComplete({ provider: "openai", apiKey: mockApiKey, request: streamRequest }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error).toMatchObject({ code: 401, retries_attempted: 0 });
  });

  it("still throws for an invalid request without stream", async () => {
    await expect(
      chatComplete({
        provider: "nope",
        apiKey: mockApiKey,
        request: { ...streamRequest, stream: false },
      }),
    ).rejects.toThrow();
  });
});

/** A full Anthropic stream for "Hello", ending with the given stop reason. */
function anthropicStream(stopReason = "end_turn"): string[] {
  return [
    sseEvent("message_start", {
      type: "message_start",
      message: { id: "msg_123", model: "claude-haiku-4-5-20251001", usage: { input_tokens: 10 } },
    }),
    sseEvent("content_block_start", { type: "content_block_start", index: 0 }),
    sseEvent("ping", { type: "ping" }),
    sseEvent("content_block_delta", { delta: { type: "text_delta", text: "Hel" } }),
    sseEvent("content_block_delta", { delta: { type: "text_delta", text: "lo" } }),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("message_delta", { delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } }),
    sseEvent("message_stop", { type: "message_stop" }),
  ];
}

function anthropicRequest() {
  return ChatCompletionRequestSchema.parse({
    model: "claude-haiku-4-5",
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
    ],
    stream: true,
  });
}

describe("anthropic streaming", () => {
  it("turns Anthropic events into chunks", async () => {
    mockStreamFetch({ pieces: anthropicStream() });

    const chunks = await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    expect(chunks.map((c) => c.choices[0]?.delta)).toEqual([
      { role: "assistant", content: "" },
      { role: null, content: "Hel" },
      { role: null, content: "lo" },
      { role: null, content: null },
    ]);
    expect(chunks.every((c) => c.id === "msg_123" && c.provider === "anthropic")).toBe(true);
    expect(chunks[0]?.model).toBe("claude-haiku-4-5-20251001");
    expect(chunks[3]?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks[3]?.choices[0]?.provider_finish_reason).toBe("end_turn");
    expect(chunks[3]?.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it("POSTs the Anthropic request with stream: true", async () => {
    const fetch = mockStreamFetch({ pieces: anthropicStream() });

    await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hi" }],
      system: "Be brief.",
      stream: true,
    });
    expect(init?.headers).toMatchObject({ "x-api-key": mockApiKey });
  });

  it("sends the workspace header when a workspace is set", async () => {
    const fetch = mockStreamFetch({ pieces: anthropicStream() });
    const provider = getProvider("anthropic", mockApiKey, { workspaceId: "wrkspc_1" });

    await collect(provider.stream(anthropicRequest()));

    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      "anthropic-workspace-id": "wrkspc_1",
    });
  });

  it("stops at message_stop", async () => {
    mockStreamFetch({
      pieces: [
        ...anthropicStream(),
        sseEvent("content_block_delta", { delta: { type: "text_delta", text: "late" } }),
      ],
    });

    const chunks = await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    expect(chunks).toHaveLength(4);
  });

  it("skips non-text and empty deltas", async () => {
    mockStreamFetch({
      pieces: [
        sseEvent("content_block_delta", { delta: { type: "thinking_delta", thinking: "hmm" } }),
        sseEvent("content_block_delta", { delta: { type: "input_json_delta", partial_json: "{" } }),
        sseEvent("content_block_delta", { delta: { type: "text_delta", text: "" } }),
        sseEvent("message_stop", {}),
      ],
    });

    const chunks = await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    expect(chunks).toEqual([]);
  });

  it.each([
    ["max_tokens", "length"],
    ["refusal", "content_filter"],
    ["a_new_reason", "stop"],
  ])("maps stop reason %s to %s and keeps the original", async (original, mapped) => {
    mockStreamFetch({ pieces: anthropicStream(original) });

    const chunks = await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    expect(chunks[3]?.choices[0]?.finish_reason).toBe(mapped);
    expect(chunks[3]?.choices[0]?.provider_finish_reason).toBe(original);
  });

  it("turns an error event into an error chunk", async () => {
    mockStreamFetch({
      pieces: [
        anthropicStream()[0] ?? "",
        sseEvent("error", {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        }),
      ],
    });

    const chunks = await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      error: { message: "Overloaded" },
    });
  });

  it("uses a default message when the error event has none", async () => {
    mockStreamFetch({ pieces: [sseEvent("error", {})] });

    const [chunk] = await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    expect(chunk?.error?.message).toBe("anthropic stream error");
  });

  it("retries the start of the stream", async () => {
    const fetch = mockStreamFetch({ status: 503 }, { pieces: anthropicStream() });

    const chunks = await collect(streamingProvider("anthropic").stream(anthropicRequest()));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(4);
  });

  it("streams through chatComplete", async () => {
    mockStreamFetch({ pieces: anthropicStream() });

    const chunks = await collect(
      chatComplete({
        provider: "anthropic",
        apiKey: mockApiKey,
        request: {
          model: "claude-haiku-4-5",
          messages: [{ role: "user", content: "Hi" }],
          stream: true,
        },
      }),
    );

    expect(chunks.map((c) => c.choices[0]?.delta.content).join("")).toBe("Hello");
  });
});

/** One streamed Gemini frame with the given text, finish reason and usage. */
function geminiFrame(text: string, finishReason?: string, usage?: [number, number]) {
  return {
    candidates: [
      { content: { role: "model", parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) },
    ],
    ...(usage
      ? {
          usageMetadata: {
            promptTokenCount: usage[0],
            candidatesTokenCount: usage[1],
            totalTokenCount: usage[0] + usage[1],
          },
        }
      : {}),
  };
}

function geminiRequest(model = "gemini-2.5-flash") {
  return ChatCompletionRequestSchema.parse({
    model,
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
    ],
    stream: true,
  });
}

describe("google streaming", () => {
  it("turns Gemini frames into chunks", async () => {
    mockStreamFetch({
      pieces: [sseData(geminiFrame("Hel", undefined, [4, 1]), geminiFrame("lo", "STOP", [4, 2]))],
    });

    const chunks = await collect(streamingProvider("google").stream(geminiRequest()));

    expect(chunks.map((c) => c.choices[0]?.delta)).toEqual([
      { role: "assistant", content: "Hel" },
      { role: null, content: "lo" },
    ]);
    expect(chunks[0]?.choices[0]?.finish_reason).toBeNull();
    expect(chunks[1]?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks[1]?.choices[0]?.provider_finish_reason).toBe("STOP");
    expect(chunks[1]?.usage).toEqual({ prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
    expect(chunks[1]?.id).toBe(chunks[0]?.id);
    expect(chunks.every((c) => c.model === "gemini-2.5-flash" && c.provider === "google")).toBe(
      true,
    );
  });

  it("POSTs the Gemini request to the stream URL", async () => {
    const fetch = mockStreamFetch({ pieces: [sseData(geminiFrame("Hi", "STOP"))] });

    await collect(streamingProvider("google").stream(geminiRequest()));

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      systemInstruction: { parts: [{ text: "Be brief." }] },
    });
    expect(init?.headers).toMatchObject({ "x-goog-api-key": mockApiKey });
  });

  it("encodes the model name in the stream URL", async () => {
    const fetch = mockStreamFetch({ pieces: [] });

    await collect(streamingProvider("google").stream(geminiRequest("a/b?c")));

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/a%2Fb%3Fc:streamGenerateContent?alt=sse",
    );
  });

  it("leaves usage null when the frame has none", async () => {
    mockStreamFetch({ pieces: [sseData(geminiFrame("Hi"))] });

    const [chunk] = await collect(streamingProvider("google").stream(geminiRequest()));

    expect(chunk?.usage).toBeNull();
  });

  it("streams only the first candidate", async () => {
    const frame = geminiFrame("first");
    frame.candidates.push({ content: { role: "model", parts: [{ text: "second" }] } });
    mockStreamFetch({ pieces: [sseData(frame)] });

    const chunks = await collect(streamingProvider("google").stream(geminiRequest()));

    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(["first"]);
  });

  it("skips a frame with no candidates and no block reason", async () => {
    mockStreamFetch({ pieces: [sseData({ usageMetadata: { promptTokenCount: 3 } })] });

    expect(await collect(streamingProvider("google").stream(geminiRequest()))).toEqual([]);
  });

  it.each([
    ["MAX_TOKENS", "length"],
    ["SAFETY", "content_filter"],
    ["IMAGE_SAFETY", "stop"],
  ])("maps finish reason %s to %s and keeps the original", async (original, mapped) => {
    mockStreamFetch({ pieces: [sseData(geminiFrame("", original))] });

    const [chunk] = await collect(streamingProvider("google").stream(geminiRequest()));

    expect(chunk?.choices[0]?.finish_reason).toBe(mapped);
    expect(chunk?.choices[0]?.provider_finish_reason).toBe(original);
  });

  it("reads frames sent with \\r\\n line endings", async () => {
    mockStreamFetch({ pieces: [`data: ${JSON.stringify(geminiFrame("Hi", "STOP"))}\r\n\r\n`] });

    const chunks = await collect(streamingProvider("google").stream(geminiRequest()));

    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(["Hi"]);
  });

  it("retries the start of the stream", async () => {
    const fetch = mockStreamFetch(
      { status: 500 },
      { pieces: [sseData(geminiFrame("Hi", "STOP"))] },
    );

    const chunks = await collect(streamingProvider("google").stream(geminiRequest()));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(1);
  });

  // New in the TS port: Python skips this frame, so the stream is empty.
  it.each(["SAFETY", "BLOCKLIST", "OTHER"])(
    "reports a prompt blocked with %s as one content_filter chunk",
    async (blockReason) => {
      mockStreamFetch({
        pieces: [
          sseData({
            promptFeedback: { blockReason },
            usageMetadata: { promptTokenCount: 8, totalTokenCount: 8 },
          }),
        ],
      });

      const chunks = await collect(streamingProvider("google").stream(geminiRequest()));

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.choices).toEqual([
        {
          index: 0,
          delta: { role: "assistant", content: null },
          finish_reason: "content_filter",
          provider_finish_reason: blockReason,
        },
      ]);
      expect(chunks[0]?.usage).toEqual({ prompt_tokens: 8, completion_tokens: 0, total_tokens: 8 });
      expect(chunks[0]?.error).toBeNull();
    },
  );
});

/** One DashScope stream frame, in the exact text format DashScope sends. */
function qwenFrame(
  id: number,
  text: string,
  finishReason = "null",
  usage: [number, number] | null = [7, id],
): string {
  const data = {
    output: {
      choices: [{ message: { role: "assistant", content: text }, finish_reason: finishReason }],
    },
    ...(usage
      ? {
          usage: {
            input_tokens: usage[0],
            output_tokens: usage[1],
            total_tokens: usage[0] + usage[1],
          },
        }
      : {}),
    request_id: "req-1",
  };
  return `id:${id}\nevent:result\n:HTTP_STATUS/200\ndata:${JSON.stringify(data)}\n\n`;
}

const qwenStream = [qwenFrame(1, "Hel"), qwenFrame(2, "lo"), qwenFrame(3, "", "stop")];

describe("qwen streaming", () => {
  it("turns DashScope frames into chunks", async () => {
    mockStreamFetch({ pieces: qwenStream });

    const chunks = await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    expect(chunks.map((c) => c.choices[0]?.delta)).toEqual([
      { role: "assistant", content: "Hel" },
      { role: null, content: "lo" },
      { role: null, content: null },
    ]);
    expect(chunks[2]?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks[2]?.choices[0]?.provider_finish_reason).toBe("stop");
    expect(chunks[2]?.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
    expect(chunks.every((c) => c.id === "req-1" && c.provider === "qwen")).toBe(true);
    expect(chunks[0]?.model).toBe("qwen-plus");
  });

  it('ignores the "null" finish reason DashScope sends while streaming', async () => {
    mockStreamFetch({ pieces: qwenStream });

    const chunks = await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    expect(chunks[0]?.choices[0]?.finish_reason).toBeNull();
    expect(chunks[0]?.choices[0]?.provider_finish_reason).toBeNull();
  });

  it("POSTs with incremental output and the SSE header", async () => {
    const fetch = mockStreamFetch({ pieces: qwenStream });

    await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    );
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${mockApiKey}`,
      "X-DashScope-SSE": "enable",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "qwen-plus",
      input: { messages: [{ role: "user", content: "Hi" }] },
      parameters: { result_format: "message", incremental_output: true },
    });
  });

  it("uses the workspace URL when a workspace is set", async () => {
    const fetch = mockStreamFetch({ pieces: qwenStream });
    const provider = getProvider("qwen", mockApiKey, { workspaceId: "ws-1" });

    await collect(provider.stream(hiRequest("qwen-plus")));

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://ws-1.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    );
  });

  it("reads the legacy output.text format", async () => {
    const data = { output: { text: "Hi", finish_reason: "stop" }, request_id: "req-2" };
    mockStreamFetch({ pieces: [`data:${JSON.stringify(data)}\n\n`] });

    const [chunk] = await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    expect(chunk?.choices[0]?.delta).toEqual({ role: "assistant", content: "Hi" });
    expect(chunk?.choices[0]?.finish_reason).toBe("stop");
    expect(chunk?.id).toBe("req-2");
  });

  it("skips frames with no text, finish reason or usage", async () => {
    mockStreamFetch({ pieces: [qwenFrame(1, "Hi"), qwenFrame(2, "", "null", null)] });

    const chunks = await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    expect(chunks).toHaveLength(1);
  });

  // Kept from Python: the role is marked as sent before the empty-frame check.
  it("drops the role when the first frame is empty, as Python does", async () => {
    mockStreamFetch({ pieces: [qwenFrame(1, "", "null", null), qwenFrame(2, "Hi")] });

    const chunks = await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    expect(chunks.map((c) => c.choices[0]?.delta)).toEqual([{ role: null, content: "Hi" }]);
  });

  it("maps an unknown finish reason to stop and keeps the original", async () => {
    mockStreamFetch({ pieces: [qwenFrame(1, "", "something_new")] });

    const [chunk] = await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    expect(chunk?.choices[0]?.finish_reason).toBe("stop");
    expect(chunk?.choices[0]?.provider_finish_reason).toBe("something_new");
  });

  it("retries the start of the stream", async () => {
    const fetch = mockStreamFetch({ status: 502 }, { pieces: qwenStream });

    const chunks = await collect(streamingProvider("qwen").stream(hiRequest("qwen-plus")));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(3);
  });

  it("reports an unsafe workspaceId as an error chunk through chatComplete", async () => {
    const fetch = mockStreamFetch();

    const chunks = await collect(
      chatComplete({
        provider: "qwen",
        apiKey: mockApiKey,
        workspaceId: "evil.com/x",
        request: { model: "qwen-plus", messages: [{ role: "user", content: "Hi" }], stream: true },
      }),
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error?.message).toContain("Invalid Qwen workspaceId");
  });
});
