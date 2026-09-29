/**
 * Tests for BaseProvider, ported from the Python `tests/test_base_provider.py`.
 *
 * Differences from the Python file:
 * - DEFAULT_MAX_RETRIES / DEFAULT_RETRY_DELAY are imported from `constants` (the Python file imports
 *   them from `base.py`, which does not export them, so that whole file fails to load).
 * - `retries_attempted` is filled in by the TS port, so `test_max_retries_exhausted` passes here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY } from "../src/constants";
import type { ChatCompletionRequest, ChatCompletionResponse, Provider } from "../src/models";
import { ChatCompletionRequestSchema, ChatCompletionResponseSchema } from "../src/models";
import { BaseProvider, type ProviderOptions } from "../src/providers/base";
import { mockApiKey, mockFetch, openaiResponse } from "./fixtures";

/** Concrete implementation of BaseProvider for testing. */
class ConcreteProvider extends BaseProvider {
  protected override readonly responseModel = ChatCompletionResponseSchema;

  get baseUrl(): string {
    return "https://api.test.com/v1";
  }

  get providerName(): Provider {
    // Not a real provider name; the Python test uses it the same way.
    return "test_provider" as Provider;
  }

  getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  getEndpoint(): string {
    return "/chat/completions";
  }

  transformRequest(request: ChatCompletionRequest): unknown {
    return request;
  }

  transformResponse(response: unknown): ChatCompletionResponse {
    return ChatCompletionResponseSchema.parse(response);
  }
}

const URL = "https://api.test.com/v1/chat/completions";

function helloRequest(): ChatCompletionRequest {
  return ChatCompletionRequestSchema.parse({
    model: "test-model",
    messages: [{ role: "user", content: "Hello" }],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BaseProvider initialization", () => {
  it("initializes with default values", () => {
    const provider = new ConcreteProvider({ apiKey: mockApiKey });

    expect(provider.apiKey).toBe(mockApiKey);
    expect(provider.maxRetries).toBe(DEFAULT_MAX_RETRIES);
    expect(provider.retryDelay).toBe(DEFAULT_RETRY_DELAY);
    expect(provider.timeout).toBe(60.0);
  });

  it("initializes with custom values", () => {
    const provider = new ConcreteProvider({
      apiKey: mockApiKey,
      maxRetries: 5,
      retryDelay: 2.0,
      timeout: 120.0,
    });

    expect(provider.maxRetries).toBe(5);
    expect(provider.retryDelay).toBe(2.0);
    expect(provider.timeout).toBe(120.0);
  });
});

describe("exponential backoff calculation", () => {
  it("increases exponentially with each attempt", () => {
    const provider = new ConcreteProvider({ apiKey: mockApiKey, retryDelay: 1.0 });

    // Base values before jitter: 1, 2, 4 (plus up to 10% jitter)
    const backoff0 = provider.calculateBackoff(0);
    const backoff1 = provider.calculateBackoff(1);
    const backoff2 = provider.calculateBackoff(2);

    expect(backoff0).toBeGreaterThanOrEqual(1.0);
    expect(backoff0).toBeLessThanOrEqual(1.1);
    expect(backoff1).toBeGreaterThanOrEqual(2.0);
    expect(backoff1).toBeLessThanOrEqual(2.2);
    expect(backoff2).toBeGreaterThanOrEqual(4.0);
    expect(backoff2).toBeLessThanOrEqual(4.4);
  });

  it("uses the configured retry delay", () => {
    const provider = new ConcreteProvider({ apiKey: mockApiKey, retryDelay: 2.0 });

    const backoff0 = provider.calculateBackoff(0);

    expect(backoff0).toBeGreaterThanOrEqual(2.0);
    expect(backoff0).toBeLessThanOrEqual(2.2);
  });
});

describe("retryable status codes", () => {
  it("treats 429 and 5xx gateway errors as retryable", () => {
    const provider = new ConcreteProvider({ apiKey: mockApiKey });

    for (const code of [429, 500, 502, 503, 504]) {
      expect(provider.isRetryable(code)).toBe(true);
    }
  });

  it("treats other status codes as not retryable", () => {
    const provider = new ConcreteProvider({ apiKey: mockApiKey });

    for (const code of [200, 400, 401, 403, 404]) {
      expect(provider.isRetryable(code)).toBe(false);
    }
  });

  it("treats a missing status code as not retryable", () => {
    const provider = new ConcreteProvider({ apiKey: mockApiKey });

    expect(provider.isRetryable(null)).toBe(false);
  });
});

describe("chatComplete", () => {
  it("returns the response for a successful request", async () => {
    const fetch = mockFetch({ json: openaiResponse() });
    const provider = new ConcreteProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(helloRequest());

    expect(result.id).toBe(openaiResponse().id);
    expect(result.provider).toBe("test_provider");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(URL);
  });

  it("retries on rate limit (429)", async () => {
    const fetch = mockFetch(
      { json: { error: "rate limited" }, status: 429 },
      { json: openaiResponse() },
    );
    const provider = new ConcreteProvider({ apiKey: mockApiKey, retryDelay: 0.01 });

    const result = await provider.chatComplete(helloRequest());

    expect(result.error).toBeNull();
    expect(result.provider).toBe("test_provider");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on server error (500)", async () => {
    const fetch = mockFetch(
      { json: { error: "internal server error" }, status: 500 },
      { json: openaiResponse() },
    );
    const provider = new ConcreteProvider({ apiKey: mockApiKey, retryDelay: 0.01 });

    const result = await provider.chatComplete(helloRequest());

    expect(result.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on client error (400)", async () => {
    const fetch = mockFetch({ json: { error: "bad request" }, status: 400 });
    const provider = new ConcreteProvider({ apiKey: mockApiKey, retryDelay: 0.01 });

    const result = await provider.chatComplete(helloRequest());

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(400);
    expect(result.error?.retries_attempted).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an error after max retries are exhausted", async () => {
    // max_retries (3) + 1 initial attempt
    const rateLimited = { json: { error: "rate limited" }, status: 429 };
    const fetch = mockFetch(rateLimited, rateLimited, rateLimited, rateLimited);
    const provider = new ConcreteProvider({ apiKey: mockApiKey, maxRetries: 3, retryDelay: 0.01 });

    const result = await provider.chatComplete(helloRequest());

    expect(result.error).not.toBeNull();
    expect(result.error?.retries_attempted).toBe(3);
    expect(result.provider).toBe("test_provider");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("passes a timeout to the request", async () => {
    const fetch = mockFetch({
      json: { id: "test", object: "chat.completion", choices: [], usage: {} },
    });
    const provider = new ConcreteProvider({ apiKey: mockApiKey, timeout: 30.0 });

    await provider.chatComplete(helloRequest());

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the headers and a JSON body without null fields", async () => {
    const fetch = mockFetch({ json: openaiResponse() });
    const provider = new ConcreteProvider({ apiKey: mockApiKey });

    await provider.chatComplete(
      ChatCompletionRequestSchema.parse({
        model: "test-model",
        messages: [{ role: "user", content: "Hello", name: null }],
        temperature: null,
      }),
    );

    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${mockApiKey}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "test-model",
      messages: [{ role: "user", content: "Hello" }],
    });
  });
});

describe("abstract methods", () => {
  it("cannot instantiate BaseProvider directly", () => {
    const Abstract = BaseProvider as unknown as new (options: ProviderOptions) => BaseProvider;

    expect(() => new Abstract({ apiKey: "test" })).toThrow(TypeError);
  });
});
