/** Tests for the DeepSeek provider, ported from the Python `tests/test_deepseek_provider.py`. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema, Provider } from "../src/rezunateLlmSdk/models";
import { DeepSeekProvider } from "../src/rezunateLlmSdk/providers/deepseekProvider";
import {
  deepseekResponse,
  mockApiKey,
  mockFetch,
  openaiRequest,
  sampleConversation,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A DeepSeek response with a single choice. */
function withChoice(finishReason: string, content: string) {
  return {
    ...deepseekResponse(),
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
  };
}

function hiRequest(model = "deepseek-chat") {
  return ChatCompletionRequestSchema.parse({
    model,
    messages: [{ role: "user", content: "Hi" }],
  });
}

/** The JSON body of the first request sent through the mocked fetch. */
function sentBody(fetch: ReturnType<typeof mockFetch>): Record<string, unknown> {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
}

describe("DeepSeek provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("initializes the SDK client with DeepSeek's base URL", () => {
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });
    expect(provider.client.baseURL.replace(/\/$/, "")).toBe("https://api.deepseek.com/v1");
  });

  it("has the correct provider name", () => {
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe(Provider.DEEPSEEK);
  });

  it("has the correct endpoint", () => {
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint()).toBe("/chat/completions");
  });

  it("includes authorization in the headers", () => {
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers.Authorization).toBe(`Bearer ${mockApiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("DeepSeek request transformation", () => {
  it("passes the request through unchanged", () => {
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });
    const reqObj = ChatCompletionRequestSchema.parse(openaiRequest());

    expect(provider.transformRequest(reqObj)).toBe(reqObj);
  });
});

describe("DeepSeek SDK forwarding", () => {
  it("forwards DeepSeek's beta prefix field", async () => {
    const fetch = mockFetch({ json: deepseekResponse() });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    await provider.chatComplete(
      ChatCompletionRequestSchema.parse({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "Continue: Hello," }],
        prefix: "Hello, ",
      }),
    );

    expect(sentBody(fetch).prefix).toBe("Hello, ");
  });

  it("forwards all turns of a multi-turn conversation", async () => {
    const fetch = mockFetch({ json: deepseekResponse() });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    await provider.chatComplete(
      ChatCompletionRequestSchema.parse({ model: "deepseek-chat", messages: sampleConversation() }),
    );

    const messages = sentBody(fetch).messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("DeepSeek response handling", () => {
  it("sets the provider field to deepseek", async () => {
    mockFetch({ json: deepseekResponse() });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.provider).toBe(Provider.DEEPSEEK);
  });

  it("maps finish_reason length", async () => {
    mockFetch({ json: withChoice("length", "Truncated...") });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.choices[0]?.finish_reason).toBe("length");
  });

  it("maps finish_reason tool_calls", async () => {
    mockFetch({ json: withChoice("tool_calls", "calling tool") });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("maps insufficient_system_resource to stop", async () => {
    mockFetch({
      json: {
        ...withChoice("insufficient_system_resource", "Partial reasoning..."),
        model: "deepseek-reasoner",
      },
    });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest("deepseek-reasoner"));

    expect(result.error).toBeNull();
    expect(result.choices[0]?.finish_reason).toBe("stop");
  });
});

describe("DeepSeek integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: deepseekResponse() });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(
      ChatCompletionRequestSchema.parse({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "Hello!" }],
      }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(sentBody(fetch).model).toBe("deepseek-chat");
    expect(result.provider).toBe(Provider.DEEPSEEK);
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.usage.total_tokens).toBe(30);
  });

  it("returns API errors as error info", async () => {
    mockFetch({ json: { error: { message: "Insufficient Balance" } }, status: 402 });
    const provider = new DeepSeekProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("Insufficient Balance");
    expect(result.provider).toBe(Provider.DEEPSEEK);
  });
});
