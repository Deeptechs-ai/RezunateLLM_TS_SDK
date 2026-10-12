/**
 * Reversible masking end to end, ported from the Python
 * `tests/guardrails/test_reversible_masking.py` (the MaskVault unit tests are in
 * masking.test.ts). Added in the TS port: `rehydrate: false`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete, Gateway, type GatewayOptions } from "../src/rezunateLlmSdk/gateway";
import { checkGuardrails } from "../src/rezunateLlmSdk/guardrails";
import { MaskVault, unmask } from "../src/rezunateLlmSdk/masking";
import { type ChatCompletionChunk, GuardrailsConfigSchema } from "../src/rezunateLlmSdk/models";
import { anthropicResponse, mockFetch, mockStreamFetch, sseEvent } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SSN_PATTERN = String.raw`\b\d{3}-\d{2}-\d{4}\b`;
const EMAIL_PATTERN = String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`;

const redactConfig = () =>
  GuardrailsConfigSchema.parse({
    guardrails: [
      { name: "ssn", pattern: SSN_PATTERN, action: "redact", replacement: "[SSN]" },
      { name: "email", pattern: EMAIL_PATTERN, action: "redact", replacement: "[EMAIL]" },
    ],
  });

const NO_LOCAL_RULES = GuardrailsConfigSchema.parse({ guardrails: [] });

const anthropicReplyWith = (text: string) => ({
  json: { ...anthropicResponse(), content: [{ type: "text", text }] },
});

const request = (content: string) => ({
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user" as const, content }],
  max_tokens: 100,
});

function gateway(options: GatewayOptions = {}) {
  return new Gateway({
    defaultProvider: "anthropic",
    defaultApiKey: "anthropic-key",
    rezunateLlmApiKey: "rez-test-key",
    ...options,
  });
}

/** The text sent to the provider in the given fetch call. */
const sentBody = (fetch: ReturnType<typeof mockFetch>, call = 0) =>
  String(fetch.mock.calls[call]?.[1]?.body);

describe("local regex rules with a vault", () => {
  it("gives each value its own restorable placeholder", () => {
    const vault = new MaskVault();
    const text = "SSNs 111-22-3333 and 444-55-6666";

    const [redacted] = checkGuardrails(text, redactConfig(), "input", vault);

    expect(redacted).toBe("SSNs [SSN_1] and [SSN_2]");
    expect(vault.restore(redacted)).toBe(text);
  });

  it("uses the static replacement without a vault", () => {
    const [redacted] = checkGuardrails("SSNs 111-22-3333 and 444-55-6666", redactConfig(), "input");

    expect(redacted).toBe("SSNs [SSN] and [SSN]");
  });
});

describe("reversible masking through the Gateway", () => {
  it("masks the input and restores the reply", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = mockFetch(anthropicReplyWith("Your number [SSN_1] is on file."));

    const result = await gateway({ guardrailsConfig: redactConfig() }).chatComplete(
      request("My SSN is 123-45-6789"),
      { reversible: true },
    );

    expect(sentBody(fetch)).not.toContain("123-45-6789");
    expect(sentBody(fetch)).toContain("[SSN_1]");
    expect(result.choices[0]?.message.content).toBe("Your number 123-45-6789 is on file.");
  });

  it("keeps the static masking when reversible is off", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = mockFetch(anthropicReplyWith("noted [SSN]"));

    const result = await gateway({ guardrailsConfig: redactConfig() }).chatComplete(
      request("My SSN is 123-45-6789"),
    );

    expect(sentBody(fetch)).toContain("[SSN]");
    expect(sentBody(fetch)).not.toContain("[SSN_1]");
    expect(result.choices[0]?.message.content).toBe("noted [SSN]");
  });

  it("keeps the reply masked with rehydrate: false", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch(anthropicReplyWith("Noted [SSN_1]."));
    const vault = new MaskVault();

    const result = await gateway({ guardrailsConfig: redactConfig() }).chatComplete(
      request("My SSN is 123-45-6789"),
      { reversible: true, vault, rehydrate: false },
    );

    expect(result.choices[0]?.message.content).toBe("Noted [SSN_1].");
    expect(vault.restore(result.choices[0]?.message.content ?? "")).toBe("Noted 123-45-6789.");
  });

  it("masks the input but leaves the reply to the caller in the plain chatComplete", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch(anthropicReplyWith("ok [SSN_1]"));
    const vault = new MaskVault();

    const result = await chatComplete({
      provider: "anthropic",
      apiKey: "anthropic-key",
      request: request("My SSN is 123-45-6789"),
      guardrailsConfig: redactConfig(),
      vault,
    });

    expect(result.choices[0]?.message.content).toBe("ok [SSN_1]");
    expect(unmask(result.choices[0]?.message.content ?? "", vault)).toBe("ok 123-45-6789");
  });

  it("keeps the numbering when a conversation is resumed from a saved vault", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = redactConfig();
    const vault = new MaskVault();
    mockFetch(anthropicReplyWith("ok [SSN_1]"));
    await gateway({ guardrailsConfig: config }).chatComplete(request("SSN 123-45-6789"), {
      reversible: true,
      vault,
    });
    const saved = vault.dumps();

    mockFetch(anthropicReplyWith("both [SSN_1] and [SSN_2]"));
    const result = await gateway({ guardrailsConfig: config }).chatComplete(
      request("and 999-88-7777"),
      { reversible: true, vault: MaskVault.loads(saved) },
    );

    expect(result.choices[0]?.message.content).toBe("both 123-45-6789 and 999-88-7777");
  });

  it("masks server-detected PII reversibly and restores it", async () => {
    const fetch = mockFetch(
      {
        json: {
          entities: [
            { text: "john@acme.com", label: "email address", score: 0.99, start: 12, end: 25 },
          ],
          action: "redact",
          blocked: false,
          text: "My email is [EMAIL].",
        },
      },
      anthropicReplyWith("Confirmed [EMAIL_ADDRESS_1]."),
    );
    const gw = gateway({
      guardrailsConfig: NO_LOCAL_RULES,
      serverGuardrails: { directions: ["input"] },
    });

    const result = await gw.chatComplete(request("My email is john@acme.com"), {
      reversible: true,
    });

    expect(sentBody(fetch, 1)).not.toContain("john@acme.com");
    expect(sentBody(fetch, 1)).toContain("[EMAIL_ADDRESS_1]");
    expect(result.choices[0]?.message.content).toBe("Confirmed john@acme.com.");
  });

  it("restores a streamed reply, even with a placeholder split across chunks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const textDelta = (text: string) =>
      sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
    mockStreamFetch({
      pieces: [
        sseEvent("message_start", {
          message: { id: "m", model: "claude-sonnet-4-20250514", usage: { input_tokens: 5 } },
        }),
        textDelta("Number [SSN"),
        textDelta("_1] noted."),
        sseEvent("message_delta", {
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 6 },
        }),
        sseEvent("message_stop", {}),
      ],
    });

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of gateway({ guardrailsConfig: redactConfig() }).chatComplete(
      { ...request("My SSN is 123-45-6789"), stream: true },
      { reversible: true },
    )) {
      chunks.push(chunk);
    }

    const text = chunks.map((c) => c.choices[0]?.delta.content ?? "").join("");
    expect(text).toBe("Number 123-45-6789 noted.");
  });

  it("keeps concurrent calls on one shared Gateway apart", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // A provider that echoes back the (masked) text it receives.
    const seenByProvider: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const content: string = body.messages.at(-1).content;
        seenByProvider.push(content);
        return new Response(JSON.stringify(anthropicReplyWith(content).json), { status: 200 });
      }),
    );
    const shared = gateway({ guardrailsConfig: redactConfig() });

    const originals = Array.from(
      { length: 50 },
      (_, i) => `Contact user${i}@acme.com, SSN 123-45-${String(i).padStart(4, "0")}.`,
    );
    const results = await Promise.all(
      originals.map((content) => shared.chatComplete(request(content), { reversible: true })),
    );

    // Every caller gets exactly its own values back...
    expect(results.map((r) => r.choices[0]?.message.content)).toEqual(originals);
    // ...and each call used its own vault, so the provider only ever saw "_1" placeholders.
    expect(seenByProvider.every((text) => text === "Contact [EMAIL_1], SSN [SSN_1].")).toBe(true);
  });
});
