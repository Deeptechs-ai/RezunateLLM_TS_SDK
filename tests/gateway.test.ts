/** Tests for the gateway, ported from the Feature 1 parts of the Python `tests/test_gateway.py`. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete, getAvailableProviders } from "../src/gateway";
import {
  deepseekResponse,
  grokResponse,
  mockApiKey,
  mockFetch,
  openaiResponse,
  sampleMessages,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The JSON body of the first request sent through the mocked fetch. */
function sentBody(fetch: ReturnType<typeof mockFetch>): Record<string, unknown> {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
}

describe("chatComplete", () => {
  it("routes to the OpenAI provider", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    const result = await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: { model: "gpt-4", messages: sampleMessages() },
    });

    expect(result.provider).toBe("openai");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("routes to the Grok provider", async () => {
    const fetch = mockFetch({ json: grokResponse() });

    const result = await chatComplete({
      provider: "grok",
      apiKey: mockApiKey,
      request: { model: "grok-3-mini", messages: sampleMessages() },
    });

    expect(result.provider).toBe("grok");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.x.ai/v1/chat/completions");
  });

  it("routes to the DeepSeek provider", async () => {
    const fetch = mockFetch({ json: deepseekResponse() });

    const result = await chatComplete({
      provider: "deepseek",
      apiKey: mockApiKey,
      request: { model: "deepseek-chat", messages: sampleMessages() },
    });

    expect(result.provider).toBe("deepseek");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("passes temperature to the provider", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: { model: "gpt-4", messages: sampleMessages(), temperature: 0.5 },
    });

    expect(sentBody(fetch).temperature).toBe(0.5);
  });

  it("passes max_tokens to the provider", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: { model: "gpt-4", messages: sampleMessages(), max_tokens: 100 },
    });

    expect(sentBody(fetch).max_tokens).toBe(100);
  });

  it("passes additional parameters to the provider", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: {
        model: "gpt-4",
        messages: sampleMessages(),
        top_p: 0.9,
        frequency_penalty: 0.5,
      },
    });

    const body = sentBody(fetch);
    expect(body.top_p).toBe(0.9);
    expect(body.frequency_penalty).toBe(0.5);
  });

  it("throws for an unknown provider", async () => {
    await expect(
      chatComplete({
        provider: "unknown",
        apiKey: mockApiKey,
        request: { model: "some-model", messages: sampleMessages() },
      }),
    ).rejects.toThrow("Unknown provider");
  });

  it("returns the response in OpenAI format", async () => {
    mockFetch({ json: openaiResponse() });

    const result = await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: { model: "gpt-4", messages: sampleMessages() },
    });

    expect(result.id).not.toBeNull();
    expect(result.object).toBe("chat.completion");
    expect(result.choices).toHaveLength(1);
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(20);
    expect(result.usage.total_tokens).toBe(30);
  });
});

describe("getAvailableProviders", () => {
  it("returns a list", () => {
    expect(Array.isArray(getAvailableProviders())).toBe(true);
  });

  it("contains the ported providers", () => {
    const providers = getAvailableProviders();
    expect(providers).toContain("openai");
    expect(providers).toContain("grok");
    expect(providers).toContain("deepseek");
  });

  it("returns at least three providers", () => {
    expect(getAvailableProviders().length).toBeGreaterThanOrEqual(3);
  });
});
