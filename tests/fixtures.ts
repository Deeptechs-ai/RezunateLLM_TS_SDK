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

/** A sample xAI (Grok) chat completion response, OpenAI-shaped. */
export function grokResponse() {
  return { ...openaiResponse(), id: "chatcmpl-grok-123", model: "grok-3-mini" };
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
