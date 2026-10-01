/** Tests for the Llama (Meta) provider, ported from the Python `tests/test_llama_provider.py`. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema, Provider } from "../src/rezunateLlmSdk/models";
import { LlamaResponseSchema } from "../src/rezunateLlmSdk/providers/llamaModels";
import { LlamaProvider } from "../src/rezunateLlmSdk/providers/llamaProvider";
import { llamaResponse, mockApiKey, mockFetch, sampleConversation } from "./fixtures";

const LLAMA_FULL_URL = "https://api.llama.com/v1/chat/completions";
const LLAMA_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(fields: Record<string, unknown>) {
  return ChatCompletionRequestSchema.parse({
    model: LLAMA_MODEL,
    messages: [{ role: "user", content: "Hi" }],
    ...fields,
  });
}

/** A Llama response with the given text, stop reason and metrics. */
function responseWith(text: string, stopReason: string, metrics: [string, number][]) {
  return LlamaResponseSchema.parse({
    completion_message: {
      role: "assistant",
      content: { type: "text", text },
      stop_reason: stopReason,
    },
    metrics: metrics.map(([metric, value]) => ({ metric, value, unit: "tokens" })),
  });
}

describe("Llama provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://api.llama.com/v1");
  });

  it("has the correct provider name", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe(Provider.LLAMA);
  });

  it("has the correct endpoint", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint()).toBe("/chat/completions");
  });

  it("includes authorization in the headers", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers.Authorization).toBe(`Bearer ${mockApiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("Llama request transformation", () => {
  it("transforms a basic request", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ messages: [{ role: "user", content: "Hello!" }] }),
    );

    expect(result.model).toBe(LLAMA_MODEL);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect(result.messages[0]?.content).toBe("Hello!");
  });

  it("maps max_tokens to max_completion_tokens", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ max_tokens: 150 }));

    expect(result.max_completion_tokens).toBe(150);
  });

  it("passes temperature through", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ temperature: 0.6 }));

    expect(result.temperature).toBe(0.6);
  });

  it("passes Meta-specific extras through", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ top_k: 40, repetition_penalty: 1.1 }));

    expect(result.top_k).toBe(40);
    expect(result.repetition_penalty).toBe(1.1);
  });

  it("preserves system, user and assistant roles", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: sampleConversation() }));

    expect(result.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  // Fails in Python (issue #5); passes here because tools stay plain data until Feature 8.
  it("passes tools and response_format through", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });
    const tools = [{ type: "function", function: { name: "get_weather" } }];
    const responseFormat = { type: "json_object" };

    const result = provider.transformRequest(request({ tools, response_format: responseFormat }));

    expect(result.tools).toEqual(tools);
    expect(result.response_format).toEqual(responseFormat);
  });
});

describe("Llama response transformation", () => {
  it("transforms a basic response", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      LlamaResponseSchema.parse(llamaResponse()),
      LLAMA_MODEL,
    );

    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe(LLAMA_MODEL);
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0]?.message.role).toBe("assistant");
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
  });

  it("maps stop_reason stop", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      LlamaResponseSchema.parse(llamaResponse()),
      LLAMA_MODEL,
    );

    expect(result.choices[0]?.finish_reason).toBe("stop");
  });

  it("maps stop_reason length", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith("Truncated...", "length", [
        ["num_prompt_tokens", 10],
        ["num_completion_tokens", 100],
      ]),
      LLAMA_MODEL,
    );

    expect(result.choices[0]?.finish_reason).toBe("length");
  });

  it("maps stop_reason tool_calls", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith("calling tool", "tool_calls", []),
      LLAMA_MODEL,
    );

    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("unpacks the metrics array into usage", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      LlamaResponseSchema.parse(llamaResponse()),
      LLAMA_MODEL,
    );

    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(20);
    expect(result.usage.total_tokens).toBe(30);
  });

  it("derives total tokens when the metric is missing", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith("Hi", "stop", [
        ["num_prompt_tokens", 8],
        ["num_completion_tokens", 5],
      ]),
      LLAMA_MODEL,
    );

    expect(result.usage.total_tokens).toBe(13);
  });

  it("keeps the response id", () => {
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      LlamaResponseSchema.parse(llamaResponse()),
      LLAMA_MODEL,
    );

    expect(result.id).toBe("msg-test-123");
  });
});

describe("Llama integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: llamaResponse() });
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(
      request({ messages: [{ role: "user", content: "Hello!" }] }),
    );

    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.provider).toBe(Provider.LLAMA);
    expect(result.usage.total_tokens).toBe(30);
    expect(fetch.mock.calls[0]?.[0]).toBe(LLAMA_FULL_URL);
  });

  it("sends max_completion_tokens instead of max_tokens", async () => {
    const fetch = mockFetch({ json: llamaResponse() });
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    await provider.chatComplete(request({ max_tokens: 75 }));

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe(LLAMA_MODEL);
    expect(body.max_completion_tokens).toBe(75);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("sends the Bearer auth header", async () => {
    const fetch = mockFetch({ json: llamaResponse() });
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    await provider.chatComplete(request({}));

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${mockApiKey}`);
  });

  it("returns an error response for an API error", async () => {
    mockFetch({ json: { message: "Invalid API key" }, status: 401 });
    const provider = new LlamaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(request({}));

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(401);
    expect(result.provider).toBe(Provider.LLAMA);
  });
});
