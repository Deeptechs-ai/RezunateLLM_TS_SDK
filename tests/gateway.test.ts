/**
 * Tests for the gateway, ported from the Python `tests/test_gateway.py` and
 * `tests/guardrails/test_gateway_redaction.py` (local guardrails).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterAPIError } from "../src/rezunateLlmSdk/client";
import { chatComplete, Gateway, getAvailableProviders } from "../src/rezunateLlmSdk/gateway";
import { GuardrailsError } from "../src/rezunateLlmSdk/guardrails";
import { type ChatCompletionChunk, GuardrailsConfigSchema } from "../src/rezunateLlmSdk/models";
import {
  anthropicResponse,
  deepseekResponse,
  googleResponse,
  grokResponse,
  metaResponse,
  mockApiKey,
  mockFetch,
  mockStreamFetch,
  openaiResponse,
  promptResponse,
  qwenResponse,
  sampleMessages,
  sseData,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

describe("local guardrails", () => {
  const SSN_PATTERN = String.raw`\b\d{3}-\d{2}-\d{4}\b`;
  const ssnRule = (action: "block" | "flag" | "redact") =>
    GuardrailsConfigSchema.parse({
      guardrails: [{ name: `${action}-ssn`, pattern: SSN_PATTERN, action, replacement: "[SSN]" }],
    });

  /** An Anthropic reply with the given text. */
  const anthropicReplyWith = (text: string) => ({
    ...anthropicResponse(),
    content: [{ type: "text", text }],
  });

  const claudeRequest = (content = "Hello!") => ({
    model: "claude-sonnet-4-20250514",
    messages: [{ role: "user" as const, content }],
    max_tokens: 100,
  });

  async function collect(chunks: AsyncIterable<ChatCompletionChunk>) {
    const result: ChatCompletionChunk[] = [];
    for await (const chunk of chunks) {
      result.push(chunk);
    }
    return result;
  }

  /** An OpenAI stream that sends the given text pieces. */
  function openaiStream(...pieces: string[]) {
    const chunks = pieces.map((content) => ({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "gpt-4",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    }));
    return mockStreamFetch({ pieces: [sseData(...chunks), "data: [DONE]\n\n"] });
  }

  it("redacts PII in the model's reply", async () => {
    mockFetch({ json: anthropicReplyWith("The SSN on file is 123-45-6789.") });

    const result = await chatComplete({
      provider: "anthropic",
      apiKey: mockApiKey,
      request: claudeRequest(),
      guardrailsConfig: ssnRule("redact"),
    });

    expect(result.choices[0]?.message.content).toBe("The SSN on file is [SSN].");
  });

  it("leaves a clean reply untouched", async () => {
    mockFetch({ json: anthropicReplyWith("Hello! How can I assist you today?") });

    const result = await chatComplete({
      provider: "anthropic",
      apiKey: mockApiKey,
      request: claudeRequest(),
      guardrailsConfig: ssnRule("redact"),
    });

    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
  });

  it("redacts PII before sending, in the caller's own message too (as in Python)", async () => {
    const fetch = mockFetch({ json: anthropicReplyWith("ok") });
    const request = claudeRequest("My SSN is 123-45-6789");

    await chatComplete({
      provider: "anthropic",
      apiKey: mockApiKey,
      request,
      guardrailsConfig: ssnRule("redact"),
    });

    const sent = String(fetch.mock.calls[0]?.[1]?.body);
    expect(sent).not.toContain("123-45-6789");
    expect(sent).toContain("[SSN]");
    expect(request.messages[0]?.content).toBe("My SSN is [SSN]");
  });

  it("throws for a blocked input without calling the provider", async () => {
    const fetch = mockFetch({ json: anthropicReplyWith("ok") });

    await expect(
      chatComplete({
        provider: "anthropic",
        apiKey: mockApiKey,
        request: claudeRequest("SSN 123-45-6789"),
        guardrailsConfig: ssnRule("block"),
      }),
    ).rejects.toThrow(GuardrailsError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ends a stream with one error chunk for a blocked input", async () => {
    const chunks = await collect(
      chatComplete({
        provider: "openai",
        apiKey: mockApiKey,
        request: {
          model: "gpt-4",
          messages: [{ role: "user", content: "SSN 123-45-6789" }],
          stream: true,
        },
        guardrailsConfig: ssnRule("block"),
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error).toMatchObject({
      type: "guardrail_error",
      message: "Guardrail 'block-ssn' triggered on INPUT: ",
    });
  });

  it("stops a stream with an error chunk when the reply hits a block rule", async () => {
    openaiStream("Your SSN ", "is 123-45-6789.", " Anything else?");

    const chunks = await collect(
      chatComplete({
        provider: "openai",
        apiKey: mockApiKey,
        request: { model: "gpt-4", messages: sampleMessages(), stream: true },
        guardrailsConfig: ssnRule("block"),
      }),
    );

    expect(chunks.map((c) => c.choices[0]?.delta.content ?? null)).toEqual(["Your SSN ", null]);
    expect(chunks[1]?.error).toMatchObject({ type: "guardrail_error", code: null });
    expect(chunks[1]?.provider).toBe("openai");
  });

  it("warns about a flagged match, including the matched text (as in Python)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch({ json: anthropicReplyWith("ok") });

    const result = await chatComplete({
      provider: "anthropic",
      apiKey: mockApiKey,
      request: claudeRequest("SSN 123-45-6789"),
      guardrailsConfig: ssnRule("flag"),
    });

    expect(result.error).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "GUARDRAIL FLAG [INPUT]: rule_name='flag-ssn' rule_description='' match='123-45-6789'",
    );
  });

  it("applies the Gateway's rules, and a call's own rules instead", async () => {
    mockFetch(
      { json: anthropicReplyWith("SSN 123-45-6789") },
      { json: anthropicReplyWith("SSN 123-45-6789") },
    );
    const gateway = new Gateway({
      defaultProvider: "anthropic",
      defaultApiKey: mockApiKey,
      guardrailsConfig: ssnRule("redact"),
    });
    const flagOnly = ssnRule("flag");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const withDefault = await gateway.chatComplete(claudeRequest());
    const withOverride = await gateway.chatComplete(claudeRequest(), {
      guardrailsConfig: flagOnly,
    });

    expect(withDefault.choices[0]?.message.content).toBe("SSN [SSN]");
    expect(withOverride.choices[0]?.message.content).toBe("SSN 123-45-6789");
  });

  it("loads rules automatically from GUARDRAILS_FILE_PATH", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guardrails-"));
    try {
      const path = join(dir, "guardrails.yaml");
      writeFileSync(
        path,
        `guardrails:\n  - name: redact-ssn\n    pattern: '${SSN_PATTERN}'\n    action: redact\n`,
      );
      vi.stubEnv("GUARDRAILS_FILE_PATH", path);
      // A fresh module, because the automatic file is loaded once per process.
      vi.resetModules();
      const gateway = await import("../src/rezunateLlmSdk/gateway");
      mockFetch({ json: anthropicReplyWith("SSN 123-45-6789") });

      const result = await gateway.chatComplete({
        provider: "anthropic",
        apiKey: mockApiKey,
        request: claudeRequest(),
      });

      expect(result.choices[0]?.message.content).toBe("SSN [REDACTED]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
