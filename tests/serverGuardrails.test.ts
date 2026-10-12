/**
 * Tests for the hosted PII scan applied through Gateway.chatComplete, ported from the Python
 * `tests/guardrails/test_server_guardrails.py`. Added in the TS port: the scan request itself,
 * and a blocked input in a stream (an error chunk).
 *
 * The fake fetch answers in call order: input scans, then the provider, then output scans.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Gateway, type GatewayOptions } from "../src/rezunateLlmSdk/gateway";
import { ServerGuardrailsError } from "../src/rezunateLlmSdk/guardrails";
import { type ChatCompletionChunk, GuardrailsConfigSchema } from "../src/rezunateLlmSdk/models";
import { anthropicResponse, mockFetch } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SCAN_URL = "https://rezunatellm.com/api/v1/guardrails/scan";
const ROUTER_KEY = "rez-test-key";

/** No local rules, so these tests are isolated from GUARDRAILS_FILE_PATH. */
const NO_LOCAL_RULES = GuardrailsConfigSchema.parse({ guardrails: [] });

const anthropicReplyWith = (text: string) => ({
  json: { ...anthropicResponse(), content: [{ type: "text", text }] },
});

const scanReply = ({
  entities = [] as object[],
  action = "none",
  blocked = false,
  text = "",
} = {}) => ({ json: { entities, action, blocked, text } });

function gateway(serverGuardrails: GatewayOptions["serverGuardrails"] = true) {
  return new Gateway({
    defaultProvider: "anthropic",
    defaultApiKey: "anthropic-key",
    guardrailsConfig: NO_LOCAL_RULES,
    serverGuardrails,
    rezunateLlmApiKey: ROUTER_KEY,
  });
}

const request = (content = "Tell me about Maria.") => ({
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user" as const, content }],
  max_tokens: 100,
});

/** Scan only the output side, for tests that target output behaviour on its own. */
const OUTPUT_ONLY = { directions: ["output"] as const };

describe("server output redaction", () => {
  it("redacts the reply using the server's text", async () => {
    const fetch = mockFetch(
      anthropicReplyWith("Her email is maria@example.com."),
      scanReply({
        entities: [{ text: "maria@example.com", label: "EMAIL", score: 0.99, start: 13, end: 30 }],
        action: "redact",
        text: "Her email is [EMAIL].",
      }),
    );

    const result = await gateway(OUTPUT_ONLY).chatComplete(request());

    expect(result.choices[0]?.message.content).toBe("Her email is [EMAIL].");
    // The provider call and one (output) scan.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws ServerGuardrailsError when the scan blocks the reply", async () => {
    mockFetch(
      scanReply({ text: "Tell me about Maria." }),
      anthropicReplyWith("The SSN is 123-45-6789."),
      scanReply({
        entities: [{ text: "123-45-6789", label: "US_SSN", score: 0.98, start: 11, end: 22 }],
        action: "block",
        blocked: true,
        text: "The SSN is 123-45-6789.",
      }),
    );

    const error = await gateway()
      .chatComplete(request())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServerGuardrailsError);
    expect(error).toMatchObject({
      message: "Server guardrail blocked OUTPUT: detected US_SSN",
      action: "block",
      direction: "output",
    });
  });

  it("lets a clean reply through", async () => {
    const clean = "Maria is a fictional sales rep.";
    mockFetch(
      scanReply({ text: "Tell me about Maria." }),
      anthropicReplyWith(clean),
      scanReply({ text: clean }),
    );

    const result = await gateway().chatComplete(request());

    expect(result.choices[0]?.message.content).toBe(clean);
  });

  it("skips the scan by default", async () => {
    const raw = "Her email is maria@example.com.";
    const fetch = mockFetch(anthropicReplyWith(raw));
    const withoutServerScan = new Gateway({
      defaultProvider: "anthropic",
      defaultApiKey: "anthropic-key",
      guardrailsConfig: NO_LOCAL_RULES,
      rezunateLlmApiKey: ROUTER_KEY,
    });

    const result = await withoutServerScan.chatComplete(request());

    expect(result.choices[0]?.message.content).toBe(raw);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("turns the scan on for one call", async () => {
    mockFetch(
      scanReply({ text: "Tell me about Maria." }),
      anthropicReplyWith("Her email is maria@example.com."),
      scanReply({ action: "redact", text: "Her email is [EMAIL]." }),
    );

    const result = await gateway(false).chatComplete(request(), { serverGuardrails: true });

    expect(result.choices[0]?.message.content).toBe("Her email is [EMAIL].");
  });
});

describe("server scan directions", () => {
  it("scans input and output with true", async () => {
    const fetch = mockFetch(
      scanReply({ action: "redact", text: "[CLEAN]" }),
      anthropicReplyWith("ok"),
      scanReply({ action: "redact", text: "[CLEAN]" }),
    );

    await gateway(true).chatComplete(request("My email is maria@example.com"));

    const scanCalls = fetch.mock.calls.filter(([url]) => String(url) === SCAN_URL);
    expect(scanCalls).toHaveLength(2);
  });

  it("scans only the messages with input only, and changes the caller's message", async () => {
    const fetch = mockFetch(
      scanReply({ action: "redact", text: "My email is [EMAIL]" }),
      anthropicReplyWith("Output email bob@example.com"),
    );
    const sent = request("My email is maria@example.com");

    const result = await gateway({ directions: ["input"] }).chatComplete(sent);

    const providerBody = String(fetch.mock.calls[1]?.[1]?.body);
    expect(providerBody).not.toContain("maria@example.com");
    expect(sent.messages[0]?.content).toBe("My email is [EMAIL]");
    expect(result.choices[0]?.message.content).toBe("Output email bob@example.com");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("the scan request", () => {
  it("sends the text with the Rezunate key", async () => {
    const fetch = mockFetch(scanReply({ text: "hello" }));

    const result = await gateway().guardrails.scan("hello");

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(SCAN_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-api-key": ROUTER_KEY });
    expect(JSON.parse(String(init?.body))).toEqual({ text: "hello" });
    expect(result).toEqual({ entities: [], action: "none", blocked: false, text: "hello" });
  });

  it("ends a stream with an error chunk when the input is blocked", async () => {
    const fetch = mockFetch(
      scanReply({
        entities: [{ text: "123-45-6789", label: "US_SSN", score: 0.98, start: 7, end: 18 }],
        action: "block",
        blocked: true,
      }),
    );

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of gateway().chatComplete({
      ...request("My SSN 123-45-6789"),
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error).toMatchObject({
      type: "guardrail_error",
      message: "Server guardrail blocked INPUT: detected US_SSN",
    });
  });
});
