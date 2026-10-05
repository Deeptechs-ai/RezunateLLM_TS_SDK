/**
 * Tests for the shared retry loop, which every provider uses (known difference from Python:
 * there the openai SDK retries the OpenAI-compatible providers on its own).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema } from "../src/rezunateLlmSdk/models";
import { getProvider } from "../src/rezunateLlmSdk/providers";
import {
  anthropicResponse,
  deepseekResponse,
  googleResponse,
  grokResponse,
  metaResponse,
  mockApiKey,
  mockFetch,
  openaiResponse,
  qwenResponse,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every provider, with a model and a successful sample response. */
const PROVIDERS: [string, string, () => unknown][] = [
  ["openai", "gpt-4", openaiResponse],
  ["anthropic", "claude-haiku-4-5", anthropicResponse],
  ["google", "gemini-2.5-flash", googleResponse],
  ["grok", "grok-3-mini", grokResponse],
  ["meta", "muse-spark-1.3", metaResponse],
  ["deepseek", "deepseek-chat", deepseekResponse],
  ["qwen", "qwen-plus", qwenResponse],
];

const rateLimited = { json: { error: { message: "Rate limit exceeded" } }, status: 429 };

function hiRequest(model: string) {
  return ChatCompletionRequestSchema.parse({
    model,
    messages: [{ role: "user", content: "Hi" }],
  });
}

function fastProvider(name: string, maxRetries = 3) {
  return getProvider(name, mockApiKey, { retryDelay: 0.01, maxRetries });
}

describe.each(PROVIDERS)("%s retries through the shared loop", (name, model, response) => {
  it("retries a rate limit (429) and then succeeds", async () => {
    const fetch = mockFetch(rateLimited, { json: response() });

    const result = await fastProvider(name).chatComplete(hiRequest(model));

    expect(result.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a server error (500) and then succeeds", async () => {
    const fetch = mockFetch(
      { json: { error: { message: "Internal error" } }, status: 500 },
      { json: response() },
    );

    const result = await fastProvider(name).chatComplete(hiRequest(model));

    expect(result.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and reports retries_attempted", async () => {
    const fetch = mockFetch(rateLimited, rateLimited, rateLimited, rateLimited);

    const result = await fastProvider(name).chatComplete(hiRequest(model));

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.error?.code).toBe(429);
    expect(result.error?.retries_attempted).toBe(3);
  });

  it("does not retry a client error (400)", async () => {
    const fetch = mockFetch({ json: { error: { message: "Bad request" } }, status: 400 });

    const result = await fastProvider(name).chatComplete(hiRequest(model));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe(400);
    expect(result.error?.retries_attempted).toBe(0);
  });
});

describe("network errors", () => {
  /** A fetch that throws `error` once, then answers with the given response. */
  function failOnceThen(error: Error, response: unknown) {
    const fetch = vi.fn(async () => {
      if (fetch.mock.calls.length === 1) {
        throw error;
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("retries a real network failure (fetch failed)", async () => {
    const fetch = failOnceThen(new TypeError("fetch failed"), anthropicResponse());

    const result = await fastProvider("anthropic").chatComplete(hiRequest("claude-haiku-4-5"));

    expect(result.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a TypeError caused by a bug", async () => {
    const fetch = failOnceThen(
      new TypeError("Do not know how to serialize a BigInt"),
      anthropicResponse(),
    );

    const result = await fastProvider("anthropic").chatComplete(hiRequest("claude-haiku-4-5"));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.error?.message).toContain("BigInt");
    expect(result.error?.retries_attempted).toBe(0);
  });
});

describe("retries_attempted on reused or frozen errors", () => {
  /** A fetch that always throws the same error object. */
  function alwaysThrow(error: Error) {
    const fetch = vi.fn(async () => {
      throw error;
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("keeps the real error when the same error object fails twice", async () => {
    alwaysThrow(new TypeError("fetch failed"));

    const first = await fastProvider("anthropic", 1).chatComplete(hiRequest("claude-haiku-4-5"));
    const second = await fastProvider("anthropic", 0).chatComplete(hiRequest("claude-haiku-4-5"));

    expect(first.error?.message).toBe("fetch failed");
    expect(first.error?.retries_attempted).toBe(1);
    expect(second.error?.message).toBe("fetch failed");
    expect(second.error?.retries_attempted).toBe(0);
  });

  it("keeps the real error when the error object is frozen", async () => {
    alwaysThrow(Object.freeze(new TypeError("fetch failed")));

    const result = await fastProvider("anthropic", 0).chatComplete(hiRequest("claude-haiku-4-5"));

    expect(result.error?.message).toBe("fetch failed");
    expect(result.error?.retries_attempted).toBeNull();
  });
});

describe("retry settings", () => {
  it("respects maxRetries for OpenAI-compatible providers", async () => {
    const fetch = mockFetch(rateLimited, rateLimited);

    const result = await fastProvider("openai", 1).chatComplete(hiRequest("gpt-4"));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.error?.retries_attempted).toBe(1);
  });

  it("waits retryDelay before retrying OpenAI-compatible providers", async () => {
    mockFetch(rateLimited, { json: openaiResponse() });
    const provider = getProvider("openai", mockApiKey, { retryDelay: 0.2 });

    const start = Date.now();
    await provider.chatComplete(hiRequest("gpt-4"));

    expect(Date.now() - start).toBeGreaterThanOrEqual(190);
  });
});
