/**
 * Tests for the OpenAI provider, ported from the Python `tests/test_openai_provider.py`.
 *
 * The `openai` SDK sends requests with the global `fetch`, so `mockFetch` intercepts them.
 * (In Python the integration tests mock `requests`, which the SDK does not use, so they reach
 * the real API and fail; see Python issue #3 in the migration plan.)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema, ChatCompletionResponseSchema } from "../src/models";
import { OpenAIProvider } from "../src/providers/openaiProvider";
import { mockApiKey, mockFetch, openaiRequest, openaiResponse } from "./fixtures";

const URL = "https://api.openai.com/v1/chat/completions";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new OpenAIProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("has the correct provider name", () => {
    const provider = new OpenAIProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe("openai");
  });

  it("has the correct endpoint", () => {
    const provider = new OpenAIProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint()).toBe("/chat/completions");
  });

  it("includes authorization in the headers", () => {
    const provider = new OpenAIProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers.Authorization).toBe(`Bearer ${mockApiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("OpenAI request transformation (passthrough)", () => {
  it("passes the request through unchanged", () => {
    const provider = new OpenAIProvider({ apiKey: mockApiKey });
    const reqObj = ChatCompletionRequestSchema.parse(openaiRequest());

    const result = provider.transformRequest(reqObj);

    expect(result).toEqual(reqObj);
  });

  it("preserves all request fields", () => {
    const provider = new OpenAIProvider({ apiKey: mockApiKey });
    const reqObj = ChatCompletionRequestSchema.parse({
      model: "gpt-4",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.5,
      max_tokens: 100,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      stop: ["\n"],
    });

    const result = provider.transformRequest(reqObj);

    expect(result).toEqual(reqObj);
  });
});

describe("OpenAI response transformation (passthrough)", () => {
  it("passes the response through", () => {
    const provider = new OpenAIProvider({ apiKey: mockApiKey });
    const respObj = ChatCompletionResponseSchema.parse(openaiResponse());

    const result = provider.transformResponse(respObj);

    expect(result.id).toBe(openaiResponse().id);
  });
});

describe("OpenAI integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: openaiResponse() });
    const provider = new OpenAIProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(ChatCompletionRequestSchema.parse(openaiRequest()));

    expect(result.id).toBe(openaiResponse().id);
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.provider).toBe("openai");
    expect(result.usage.total_tokens).toBe(30);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(URL);
  });

  it("sends the correct headers and body", async () => {
    const fetch = mockFetch({ json: openaiResponse() });
    const provider = new OpenAIProvider({ apiKey: mockApiKey });

    await provider.chatComplete(ChatCompletionRequestSchema.parse(openaiRequest()));

    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${mockApiKey}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(openaiRequest());
  });

  it("returns an error response for an API error", async () => {
    mockFetch({
      json: {
        error: {
          message: "Invalid API key",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      status: 401,
    });
    const provider = new OpenAIProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(ChatCompletionRequestSchema.parse(openaiRequest()));

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(401);
    expect(result.provider).toBe("openai");
    expect(result.choices).toEqual([]);
  });
});
