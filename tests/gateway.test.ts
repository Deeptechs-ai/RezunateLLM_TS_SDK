/** Tests for the gateway, ported from the Python `tests/test_gateway.py` (no guardrails yet). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterAPIError } from "../src/rezunateLlmSdk/client";
import { chatComplete, Gateway, getAvailableProviders } from "../src/rezunateLlmSdk/gateway";
import {
  anthropicResponse,
  deepseekResponse,
  googleResponse,
  grokResponse,
  metaResponse,
  mockApiKey,
  mockFetch,
  openaiResponse,
  promptResponse,
  qwenResponse,
  sampleMessages,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  it("routes to the Anthropic provider", async () => {
    const fetch = mockFetch({ json: anthropicResponse() });

    const result = await chatComplete({
      provider: "anthropic",
      apiKey: mockApiKey,
      request: { model: "claude-sonnet-4-20250514", messages: sampleMessages(), max_tokens: 100 },
    });

    expect(result.provider).toBe("anthropic");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.anthropic.com/v1/messages");
  });

  it("routes to the Google provider", async () => {
    const fetch = mockFetch({ json: googleResponse() });

    const result = await chatComplete({
      provider: "google",
      apiKey: mockApiKey,
      request: { model: "gemini-2.0-flash", messages: sampleMessages() },
    });

    expect(result.provider).toBe("google");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
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

  it("routes to the Meta provider", async () => {
    const fetch = mockFetch({ json: metaResponse() });

    const result = await chatComplete({
      provider: "meta",
      apiKey: mockApiKey,
      request: { model: "muse-spark-1.3", messages: sampleMessages() },
    });

    expect(result.provider).toBe("meta");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.meta.ai/v1/chat/completions");
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

  it("routes to the Qwen provider", async () => {
    const fetch = mockFetch({ json: qwenResponse() });

    const result = await chatComplete({
      provider: "qwen",
      apiKey: mockApiKey,
      request: { model: "qwen-plus", messages: sampleMessages() },
    });

    expect(result.provider).toBe("qwen");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
    );
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

  it("returns the response in OpenAI format regardless of provider", async () => {
    mockFetch({ json: anthropicResponse() });

    const result = await chatComplete({
      provider: "anthropic",
      apiKey: mockApiKey,
      request: { model: "claude-sonnet-4-20250514", messages: sampleMessages(), max_tokens: 100 },
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

  it("contains all providers", () => {
    const providers = getAvailableProviders();
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("google");
    expect(providers).toContain("grok");
    expect(providers).toContain("meta");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("qwen");
  });

  it("returns at least three providers", () => {
    expect(getAvailableProviders().length).toBeGreaterThanOrEqual(3);
  });

  it("returns all seven providers", () => {
    expect(getAvailableProviders()).toHaveLength(7);
  });
});

describe("Gateway class", () => {
  const hiRequest = (model: string) => ({ model, messages: sampleMessages() });

  it("initializes with and without defaults", () => {
    const gateway = new Gateway({ defaultProvider: "openai", defaultApiKey: mockApiKey });
    expect(gateway.defaultProvider).toBe("openai");
    expect(gateway.defaultApiKey).toBe(mockApiKey);

    const empty = new Gateway();
    expect(empty.defaultProvider).toBeNull();
    expect(empty.defaultApiKey).toBeNull();
  });

  it("uses the default provider and API key", async () => {
    mockFetch({ json: openaiResponse() });
    const gateway = new Gateway({ defaultProvider: "openai", defaultApiKey: mockApiKey });

    const result = await gateway.chatComplete(hiRequest("gpt-4"));

    expect(result.provider).toBe("openai");
  });

  it("lets a call override the defaults", async () => {
    mockFetch({ json: anthropicResponse() });
    const gateway = new Gateway({ defaultProvider: "openai", defaultApiKey: "default-key" });

    const result = await gateway.chatComplete(
      { ...hiRequest("claude-sonnet-4-20250514"), max_tokens: 100 },
      { provider: "anthropic", apiKey: mockApiKey },
    );

    expect(result.provider).toBe("anthropic");
  });

  it("requires a provider", async () => {
    await expect(
      new Gateway({ defaultApiKey: mockApiKey }).chatComplete(hiRequest("gpt-4")),
    ).rejects.toThrow("Provider must be specified");
  });

  it("requires an API key", async () => {
    await expect(
      new Gateway({ defaultProvider: "openai" }).chatComplete(hiRequest("gpt-4")),
    ).rejects.toThrow("API key must be specified");
  });

  it("lists every provider", () => {
    expect(new Gateway().providers).toEqual(getAvailableProviders());
  });

  it.each([
    ["grok", "grok-3-mini", grokResponse],
    ["qwen", "qwen-plus", qwenResponse],
  ])("works with %s as the default provider", async (provider, model, response) => {
    mockFetch({ json: response() });
    const gateway = new Gateway({ defaultProvider: provider, defaultApiKey: mockApiKey });

    const result = await gateway.chatComplete(hiRequest(model));

    expect(result.provider).toBe(provider);
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
  });

  it("passes request settings through", async () => {
    const fetch = mockFetch({ json: openaiResponse() });
    const gateway = new Gateway({ defaultProvider: "openai", defaultApiKey: mockApiKey });

    await gateway.chatComplete({ ...hiRequest("gpt-4"), temperature: 0.7, max_tokens: 100 });

    expect(sentBody(fetch)).toMatchObject({ temperature: 0.7, max_tokens: 100 });
  });

  it("routes one gateway to every provider", async () => {
    const gateway = new Gateway({ defaultApiKey: mockApiKey });
    const cases: [string, string, () => unknown][] = [
      ["openai", "gpt-4", openaiResponse],
      ["anthropic", "claude-haiku-4-5", anthropicResponse],
      ["google", "gemini-2.5-flash", googleResponse],
      ["grok", "grok-3-mini", grokResponse],
      ["meta", "muse-spark-1.3", metaResponse],
      ["deepseek", "deepseek-chat", deepseekResponse],
      ["qwen", "qwen-plus", qwenResponse],
    ];

    for (const [provider, model, response] of cases) {
      mockFetch({ json: response() });
      const result = await gateway.chatComplete(hiRequest(model), { provider });
      expect(result.provider).toBe(provider);
    }
  });

  // New in the TS port: as with chatComplete, a streaming request never throws.
  it("reports a missing provider as an error chunk when streaming", async () => {
    const chunks = [];
    for await (const chunk of new Gateway({ defaultApiKey: mockApiKey }).chatComplete({
      ...hiRequest("gpt-4"),
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error).toMatchObject({
      message: "Provider must be specified",
      type: "invalid_request_error",
    });
  });

  it("fetches a prompt with the Rezunate key and fills in its variables", async () => {
    const fetch = mockFetch({ json: promptResponse() });
    const gateway = new Gateway({ rezunateLlmApiKey: "rk_live_test" });

    const text = await gateway.getPrompt(
      "customer_support_reply",
      { company_name: "Acme", customer_name: "Ali", tone: "friendly" },
      2,
    );

    expect(text).toBe("You support Acme. Reply to Ali in a friendly tone.");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://rezunatellm.com/api/v1/prompts/customer_support_reply?version=2",
    );
    expect(init?.headers).toMatchObject({ "x-api-key": "rk_live_test" });
  });

  it("creates the Rezunate client only when a prompt is needed", async () => {
    vi.stubEnv("REZUNATE_LLM_API_KEY", "");

    // Chat-only use needs no Rezunate key.
    const gateway = new Gateway({ defaultProvider: "openai", defaultApiKey: mockApiKey });

    await expect(gateway.getPrompt("customer_support_reply")).rejects.toThrow(RouterAPIError);
  });
});
