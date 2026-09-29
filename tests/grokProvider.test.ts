/** Tests for the Grok (xAI) provider, ported from the Python `tests/test_grok_provider.py`. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema, Provider } from "../src/models";
import { GrokProvider } from "../src/providers/grokProvider";
import { grokResponse, mockApiKey, mockFetch, openaiRequest, sampleConversation } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Grok response with a single choice. */
function withChoice(finishReason: string, content: string) {
  return {
    ...grokResponse(),
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
  };
}

function hiRequest() {
  return ChatCompletionRequestSchema.parse({
    model: "grok-3-mini",
    messages: [{ role: "user", content: "Hi" }],
  });
}

/** The JSON body of the first request sent through the mocked fetch. */
function sentBody(fetch: ReturnType<typeof mockFetch>): Record<string, unknown> {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
}

describe("Grok provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new GrokProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://api.x.ai/v1");
  });

  it("initializes the SDK client with the xAI base URL", () => {
    const provider = new GrokProvider({ apiKey: mockApiKey });
    expect(provider.client.baseURL.replace(/\/$/, "")).toBe("https://api.x.ai/v1");
  });

  it("has the correct provider name", () => {
    const provider = new GrokProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe(Provider.GROK);
  });

  it("has the correct endpoint", () => {
    const provider = new GrokProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint()).toBe("/chat/completions");
  });

  it("includes authorization in the headers", () => {
    const provider = new GrokProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers.Authorization).toBe(`Bearer ${mockApiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("Grok request transformation", () => {
  it("passes the request through unchanged", () => {
    const provider = new GrokProvider({ apiKey: mockApiKey });
    const reqObj = ChatCompletionRequestSchema.parse(openaiRequest());

    expect(provider.transformRequest(reqObj)).toBe(reqObj);
  });
});

describe("Grok SDK forwarding", () => {
  it("forwards xAI-specific extra fields", async () => {
    const fetch = mockFetch({ json: grokResponse() });
    const provider = new GrokProvider({ apiKey: mockApiKey });
    const searchParams = { mode: "auto", max_search_results: 5 };

    await provider.chatComplete(
      ChatCompletionRequestSchema.parse({
        model: "grok-3-mini",
        messages: [{ role: "user", content: "What's the news?" }],
        search_parameters: searchParams,
      }),
    );

    expect(sentBody(fetch).search_parameters).toEqual(searchParams);
  });

  it("forwards all turns of a multi-turn conversation", async () => {
    const fetch = mockFetch({ json: grokResponse() });
    const provider = new GrokProvider({ apiKey: mockApiKey });

    await provider.chatComplete(
      ChatCompletionRequestSchema.parse({ model: "grok-3-mini", messages: sampleConversation() }),
    );

    const messages = sentBody(fetch).messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("Grok response handling", () => {
  it("sets the provider field to grok", async () => {
    mockFetch({ json: grokResponse() });
    const provider = new GrokProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.provider).toBe(Provider.GROK);
  });

  it("maps finish_reason length", async () => {
    mockFetch({ json: withChoice("length", "Truncated...") });
    const provider = new GrokProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.choices[0]?.finish_reason).toBe("length");
  });

  it("maps finish_reason tool_calls", async () => {
    mockFetch({ json: withChoice("tool_calls", "calling tool") });
    const provider = new GrokProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
  });
});

describe("Grok integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: grokResponse() });
    const provider = new GrokProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(
      ChatCompletionRequestSchema.parse({
        model: "grok-3-mini",
        messages: [{ role: "user", content: "Hello!" }],
      }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.x.ai/v1/chat/completions");
    expect(sentBody(fetch).model).toBe("grok-3-mini");
    expect(result.provider).toBe(Provider.GROK);
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.usage.total_tokens).toBe(30);
  });

  it("returns API errors as error info", async () => {
    mockFetch({ json: { error: { message: "Invalid API key" } }, status: 401 });
    const provider = new GrokProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(hiRequest());

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("Invalid API key");
    expect(result.provider).toBe(Provider.GROK);
  });
});
