/**
 * Shared test data, the counterpart of the Python `tests/conftest.py` fixtures.
 * Functions return fresh copies so one test can't change another test's data.
 */

import { vi } from "vitest";

/** A mock API key for testing. */
export const mockApiKey = "test-api-key-12345";

/** Sample messages in OpenAI format. */
export function sampleMessages() {
  return [
    { role: "system" as const, content: "You are a helpful assistant." },
    { role: "user" as const, content: "Hello!" },
  ];
}

/** A multi-turn conversation. */
export function sampleConversation() {
  return [
    { role: "system" as const, content: "You are a helpful assistant." },
    { role: "user" as const, content: "Hello!" },
    { role: "assistant" as const, content: "Hi there! How can I help you?" },
    { role: "user" as const, content: "What is 2+2?" },
  ];
}

/** A sample OpenAI format request. */
export function openaiRequest() {
  return {
    model: "gpt-4",
    messages: sampleMessages(),
    temperature: 0.7,
    max_tokens: 100,
  };
}

/** A sample OpenAI format response. */
export function openaiResponse() {
  return {
    id: "chatcmpl-123",
    object: "chat.completion",
    created: 1677652288,
    model: "gpt-4",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello! How can I assist you today?",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

/** A sample Anthropic API response. */
export function anthropicResponse() {
  return {
    id: "msg_01XFDUDYJgAACzvnptvVoYEL",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello! How can I assist you today?" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

/** A sample Google Gemini API response. */
export function googleResponse() {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: "Hello! How can I assist you today?" }],
          role: "model",
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
    },
  };
}

/** A sample DashScope (native Qwen) API response. */
export function qwenResponse() {
  return {
    output: {
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "Hello! How can I assist you today?" },
        },
      ],
    },
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    request_id: "req-test-123",
  };
}

/** A sample xAI (Grok) chat completion response, OpenAI-shaped. */
export function grokResponse() {
  return { ...openaiResponse(), id: "chatcmpl-grok-123", model: "grok-3-mini" };
}

/**
 * A sample Meta Model API (Muse Spark) response, OpenAI-shaped.
 * Includes Meta-only fields (`reasoning_content`, token details) that our models drop.
 */
export function metaResponse() {
  const base = openaiResponse();
  return {
    ...base,
    id: "chatcmpl-meta-123",
    model: "muse-spark-1.3",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello! How can I assist you today?",
          refusal: null,
          reasoning_content: "The user greeted me.",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      ...base.usage,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 5 },
    },
  };
}

/** A sample DeepSeek chat completion response, OpenAI-shaped. */
export function deepseekResponse() {
  return { ...openaiResponse(), id: "chatcmpl-deepseek-123", model: "deepseek-chat" };
}

/** A queued fake HTTP reply: a JSON body and a status code. */
export interface FakeReply {
  json: unknown;
  status?: number;
}

/**
 * Replace the global `fetch` with a fake that answers from a queue of replies, like
 * registering replies with the Python `responses` library. No real network call is made.
 * Returns the mock so tests can inspect the calls.
 */
export function mockFetch(...replies: FakeReply[]) {
  const queue = [...replies];
  const fake = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const reply = queue.shift();
    if (!reply) {
      throw new Error("mockFetch: no more fake replies queued");
    }
    return new Response(JSON.stringify(reply.json), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}

/**
 * One fake streaming reply. `pieces` are sent in order: a string is body text, a number waits
 * that many ms, an Error breaks the stream. `hang` keeps the stream open after the last piece.
 */
export interface FakeStreamReply {
  pieces?: (string | number | Error)[];
  hang?: boolean;
  status?: number;
  throws?: Error;
  onCancel?: () => void;
}

/** Replace the global `fetch` with a fake that answers with SSE streams, one reply per call. */
export function mockStreamFetch(...replies: FakeStreamReply[]) {
  const queue = [...replies];
  const fake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const reply = queue.shift();
    if (!reply) {
      throw new Error("mockStreamFetch: no more fake replies queued");
    }
    if (reply.throws) {
      throw reply.throws;
    }
    if (reply.status !== undefined && reply.status !== 200) {
      return new Response(JSON.stringify({ error: { message: "Request failed" } }), {
        status: reply.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();
    const pieces = [...(reply.pieces ?? [])];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Like real fetch: aborting the request breaks the body.
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
      },
      async pull(controller) {
        let piece = pieces.shift();
        while (typeof piece === "number") {
          await new Promise((resolve) => setTimeout(resolve, piece as number));
          piece = pieces.shift();
        }
        if (piece === undefined) {
          if (reply.hang) {
            return new Promise<void>(() => {});
          }
          controller.close();
        } else if (piece instanceof Error) {
          controller.error(piece);
        } else {
          controller.enqueue(encoder.encode(piece));
        }
      },
      cancel() {
        reply.onCancel?.();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}

/** One SSE frame with an `event:` name and JSON-encoded `data:`. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** SSE text with one `data:` frame per event, each JSON-encoded. */
export function sseData(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
