/** Tests for the Meta provider (Meta Model API, OpenAI-compatible), in the style of the Grok tests. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema, Provider } from "../src/rezunateLlmSdk/models";
import { MetaProvider } from "../src/rezunateLlmSdk/providers/metaProvider";
import { metaResponse, mockApiKey, mockFetch, openaiRequest, sampleConversation } from "./fixtures";

const MODEL = "muse-spark-1.3";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Meta response with a single choice. */
function withChoice(finishReason: string, content: string) {
  return {
    ...metaResponse(),
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
  };
}

function hiRequest() {
  return ChatCompletionRequestSchema.parse({
    model: MODEL,
    messages: [{ role: "user", content: "Hi" }],
  });
}

/** The JSON body of the first request sent through the mocked fetch. */
function sentBody(fetch: ReturnType<typeof mockFetch>): Record<string, unknown> {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
}

describe("Meta provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new MetaProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://api.meta.ai/v1");
  });

  it("initializes the SDK client with the Meta Model API base URL", () => {
    const provider = new MetaProvider({ apiKey: mockApiKey });
    expect(provider.client.baseURL.replace(/\/$/, "")).toBe("https://api.meta.ai/v1");
  });

  it("has the correct provider name", () => {
    const provider = new MetaProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe(Provider.META);
  });

  it("has the correct endpoint", () => {
    const provider = new MetaProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint()).toBe("/chat/completions");
  });

  it("includes authorization in the headers", () => {
    const provider = new MetaProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers.Authorization).toBe(`Bearer ${mockApiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("Meta request transformation", () => {
  it("passes the request through unchanged", () => {
    const provider = new MetaProvider({ apiKey: mockApiKey });
    const reqObj = ChatCompletionRequestSchema.parse(openaiRequest());

    expect(provider.transformRequest(reqObj)).toBe(reqObj);
  });
});

describe("Meta SDK forwarding", () => {
  it("forwards all turns of a multi-turn conversation", async () => {
    const fetch = mockFetch({ json: metaResponse() });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    await provider.chatComplete(
      ChatCompletionRequestSchema.parse({ model: MODEL, messages: sampleConversation() }),
    );

    const messages = sentBody(fetch).messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("sends OpenAI-style settings unchanged", async () => {
    const fetch = mockFetch({ json: metaResponse() });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    await provider.chatComplete(
      ChatCompletionRequestSchema.parse({
        model: MODEL,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
        temperature: 0.5,
      }),
    );

    const body = sentBody(fetch);
    expect(body.model).toBe(MODEL);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.5);
  });
});

describe("Meta response handling", () => {
  it("sets the provider field to meta", async () => {
    mockFetch({ json: metaResponse() });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.provider).toBe(Provider.META);
  });

  it("drops Meta-only fields such as reasoning_content", async () => {
    mockFetch({ json: metaResponse() });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.error).toBeNull();
    expect(result.choices[0]?.message).toEqual({
      role: "assistant",
      content: "Hello! How can I assist you today?",
    });
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
  });

  it("maps finish_reason length", async () => {
    mockFetch({ json: withChoice("length", "Truncated...") });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.choices[0]?.finish_reason).toBe("length");
  });

  it("maps finish_reason tool_calls", async () => {
    mockFetch({ json: withChoice("tool_calls", "calling tool") });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
  });
});

describe("Meta integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: metaResponse() });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.meta.ai/v1/chat/completions");
    expect(result.provider).toBe(Provider.META);
    expect(result.model).toBe(MODEL);
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.usage.total_tokens).toBe(30);
  });

  it("returns API errors as error info", async () => {
    mockFetch({
      json: {
        error: {
          message: "Invalid API key",
          type: "authentication_error",
          param: null,
          code: null,
        },
      },
      status: 401,
    });
    const provider = new MetaProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(401);
    expect(result.error?.message).toContain("Invalid API key");
    expect(result.provider).toBe(Provider.META);
  });
});
