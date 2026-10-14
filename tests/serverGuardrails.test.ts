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
import { anthropicResponse, mockFetch, sseData } from "./fixtures";

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

  // New in the TS port: Python scans nothing for an empty list, without a warning.
  it("rejects an empty list of directions instead of scanning nothing", async () => {
    const fetch = mockFetch();

    await expect(gateway({ directions: [] }).chatComplete(request())).rejects.toThrow(
      "serverGuardrails directions must name at least one side",
    );
    expect(fetch).not.toHaveBeenCalled();
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

// New in the TS port: the Python SDK has no tests for scanning streamed replies.
describe("server scan of streamed replies", () => {
  /** One streamed chunk in the OpenAI format. */
  const piece = (delta: object, finishReason: string | null = null, extra: object = {}) => ({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "gpt-4",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  });

  /**
   * A fetch that streams `chunks` from the provider and answers every scan with `scan(text)`.
   * Returns the texts that were scanned.
   */
  function routedFetch(chunks: object[], scan: (text: string) => object): string[] {
    const scanned: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url) === SCAN_URL) {
          const { text } = JSON.parse(String(init?.body));
          scanned.push(text);
          return new Response(JSON.stringify(scan(text)), { status: 200 });
        }
        return new Response(`${sseData(...chunks)}data: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    return scanned;
  }

  /** A scan service that redacts email addresses. */
  const redactEmails = (text: string) => ({
    entities: [],
    action: "redact",
    blocked: false,
    text: text.replace(/\S+@\S+\.\w+/g, "[EMAIL]"),
  });

  async function streamWithOutputScan() {
    const gw = new Gateway({
      defaultProvider: "openai",
      defaultApiKey: "openai-key",
      guardrailsConfig: NO_LOCAL_RULES,
      serverGuardrails: OUTPUT_ONLY,
      rezunateLlmApiKey: ROUTER_KEY,
    });
    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of gw.chatComplete({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
    })) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it("scans a few sentences at a time and keeps the finish and usage chunks in order", async () => {
    const long = "x".repeat(190);
    const usage = { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14 };
    const scanned = routedFetch(
      [
        piece({ role: "assistant", content: "" }),
        piece({ content: `${long}. Mail ` }),
        piece({ content: "jo@a.co now." }),
        piece({ content: " Bye" }),
        piece({}, "stop"),
        { ...piece({}), choices: [], usage },
      ],
      redactEmails,
    );

    const chunks = await streamWithOutputScan();

    // The first scan waits for 200 characters and a sentence end (". "); the rest goes at the finish.
    expect(scanned).toEqual([`${long}. `, "Mail jo@a.co now. Bye"]);
    const text = chunks.map((c) => c.choices[0]?.delta.content ?? "").join("");
    expect(text).toBe(`${long}. Mail [EMAIL] now. Bye`);
    expect(chunks.at(-2)?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks.at(-1)?.usage).toEqual(usage);
  });

  it("never cuts the text for a scan inside an email address", async () => {
    const long = "x".repeat(195);
    const scanned = routedFetch(
      [
        piece({ content: `${long} Mail john.doe@example.` }),
        piece({ content: "com now." }),
        piece({}, "stop"),
      ],
      redactEmails,
    );

    const chunks = await streamWithOutputScan();

    expect(scanned).toEqual([`${long} Mail john.doe@example.com now.`]);
    const text = chunks.map((c) => c.choices[0]?.delta.content ?? "").join("");
    expect(text).toBe(`${long} Mail [EMAIL] now.`);
  });

  it("ends the stream with an error chunk when a scanned sentence is blocked", async () => {
    routedFetch(
      [
        piece({ content: "All good so far." }),
        piece({ content: " SSN 123-45-6789." }),
        piece({}, "stop"),
      ],
      (text) => ({ entities: [], action: "block", blocked: text.includes("SSN"), text }),
    );

    const chunks = await streamWithOutputScan();

    expect(chunks.at(-1)?.error).toMatchObject({
      type: "guardrail_error",
      message: "Server guardrail blocked OUTPUT: detected PII",
    });
    expect(chunks.some((c) => c.choices[0]?.finish_reason === "stop")).toBe(false);
  });

  it("passes tool-call pieces through", async () => {
    const toolCall = {
      index: 0,
      id: "call_1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"Paris"}' },
    };
    routedFetch([piece({ tool_calls: [toolCall] }), piece({}, "tool_calls")], redactEmails);

    const chunks = await streamWithOutputScan();

    expect(chunks[0]?.choices[0]?.delta.tool_calls).toEqual([toolCall]);
    expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe("tool_calls");
  });
});
