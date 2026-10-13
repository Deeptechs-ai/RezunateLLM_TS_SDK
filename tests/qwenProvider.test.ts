/** Tests for the Qwen (DashScope) provider, ported from the Python `tests/test_qwen_provider.py`. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema, Provider } from "../src/rezunateLlmSdk/models";
import { QwenResponseSchema } from "../src/rezunateLlmSdk/providers/qwenModels";
import { QwenProvider } from "../src/rezunateLlmSdk/providers/qwenProvider";
import {
  mockApiKey,
  mockFetch,
  qwenResponse,
  sampleConversation,
  sampleMessages,
} from "./fixtures";

const QWEN_FULL_URL =
  "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation";

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(fields: Record<string, unknown>) {
  return ChatCompletionRequestSchema.parse({
    model: "qwen-plus",
    messages: [{ role: "user", content: "Hi" }],
    ...fields,
  });
}

/** A DashScope response with one choice. */
function responseWith(content: string, finishReason: string, usage: [number, number, number]) {
  return QwenResponseSchema.parse({
    output: { choices: [{ finish_reason: finishReason, message: { role: "assistant", content } }] },
    usage: { input_tokens: usage[0], output_tokens: usage[1], total_tokens: usage[2] },
  });
}

describe("Qwen provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://dashscope-intl.aliyuncs.com/api/v1");
  });

  it("has the correct provider name", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe(Provider.QWEN);
  });

  it("has the correct endpoint", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint()).toBe("/services/aigc/text-generation/generation");
  });

  it("includes authorization in the headers", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers.Authorization).toBe(`Bearer ${mockApiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("Qwen request transformation", () => {
  it("moves messages under input.messages and sets result_format", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ messages: [{ role: "user", content: "Hello!" }] }),
    );

    expect(result.model).toBe("qwen-plus");
    expect(result.input.messages).toHaveLength(1);
    expect(result.input.messages[0]?.role).toBe("user");
    expect(result.input.messages[0]?.content).toBe("Hello!");
    expect(result.parameters?.result_format).toBe("message");
  });

  it("keeps the system message inside input.messages", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: sampleMessages() }));

    expect(result.input.messages).toHaveLength(2);
    expect(result.input.messages[0]?.role).toBe("system");
    expect(result.input.messages[0]?.content).toBe("You are a helpful assistant.");
    expect(result.input.messages[1]?.role).toBe("user");
  });

  it("moves sampling settings under parameters", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ temperature: 0.7, top_p: 0.9, max_tokens: 200 }),
    );

    expect(result.parameters?.temperature).toBe(0.7);
    expect(result.parameters?.top_p).toBe(0.9);
    expect(result.parameters?.max_tokens).toBe(200);
  });

  it("passes Qwen-specific extras through", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ top_k: 50, seed: 1234, enable_search: true, repetition_penalty: 1.05 }),
    );

    expect(result.parameters?.top_k).toBe(50);
    expect(result.parameters?.seed).toBe(1234);
    expect(result.parameters?.enable_search).toBe(true);
    expect(result.parameters?.repetition_penalty).toBe(1.05);
  });

  it("preserves all roles of a conversation", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: sampleConversation() }));

    expect(result.input.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
  });
});

describe("Qwen response transformation", () => {
  it("transforms a basic response", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      QwenResponseSchema.parse(qwenResponse()),
      "qwen-plus",
    );

    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("qwen-plus");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0]?.message.role).toBe("assistant");
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
  });

  it("maps finish_reason stop", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(responseWith("Done", "stop", [5, 1, 6]), "qwen-plus");

    expect(result.choices[0]?.finish_reason).toBe("stop");
  });

  it("maps finish_reason length", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith("Truncated...", "length", [5, 100, 105]),
      "qwen-plus",
    );

    expect(result.choices[0]?.finish_reason).toBe("length");
  });

  it("maps finish_reason tool_calls", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith("calling tool", "tool_calls", [5, 3, 8]),
      "qwen-plus",
    );

    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("maps DashScope usage fields", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      QwenResponseSchema.parse(qwenResponse()),
      "qwen-plus",
    );

    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(20);
    expect(result.usage.total_tokens).toBe(30);
  });

  it("uses request_id as the response id", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      QwenResponseSchema.parse(qwenResponse()),
      "qwen-plus",
    );

    expect(result.id).toBe("req-test-123");
  });

  it("falls back to the legacy text format", () => {
    const provider = new QwenProvider({ apiKey: mockApiKey });
    const response = QwenResponseSchema.parse({
      output: { text: "Hello!", finish_reason: "stop" },
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    });

    const result = provider.transformResponse(response, "qwen-plus");

    expect(result.choices[0]?.message.content).toBe("Hello!");
    expect(result.choices[0]?.finish_reason).toBe("stop");
  });
});

describe("Qwen integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: qwenResponse() });
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(
      request({ messages: [{ role: "user", content: "Hello!" }] }),
    );

    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.provider).toBe(Provider.QWEN);
    expect(fetch.mock.calls[0]?.[0]).toBe(QWEN_FULL_URL);
  });

  it("sends the request body in DashScope shape", async () => {
    const fetch = mockFetch({ json: qwenResponse() });
    const provider = new QwenProvider({ apiKey: mockApiKey });

    await provider.chatComplete(
      request({ messages: [{ role: "user", content: "Hello!" }], temperature: 0.5 }),
    );

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("qwen-plus");
    expect(body.input.messages[0].role).toBe("user");
    expect(body.parameters.result_format).toBe("message");
    expect(body.parameters.temperature).toBe(0.5);
  });

  it("sends the Bearer auth header", async () => {
    const fetch = mockFetch({ json: qwenResponse() });
    const provider = new QwenProvider({ apiKey: mockApiKey });

    await provider.chatComplete(request({}));

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${mockApiKey}`);
  });

  it("returns an error response for an API error", async () => {
    mockFetch({
      json: { code: "AccessDenied.Unpurchased", message: "Access to model denied." },
      status: 403,
    });
    const provider = new QwenProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(request({}));

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(403);
    expect(result.provider).toBe(Provider.QWEN);
  });
});
