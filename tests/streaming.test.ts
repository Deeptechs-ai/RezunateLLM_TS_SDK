/**
 * Tests for streaming: chunk models, the shared stream engine and every provider's stream.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ChatCompletionChunk,
  ChatCompletionChunkSchema,
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
  ChoiceChunkSchema,
  type Provider,
} from "../src/rezunateLlmSdk/models";
import {
  BaseProvider,
  type StreamRequest,
  type StreamState,
} from "../src/rezunateLlmSdk/providers/base";
import { mockApiKey, mockStreamFetch, sseData } from "./fixtures";

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
