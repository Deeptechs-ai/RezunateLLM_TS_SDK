/**
 * Tests for finish/stop reasons: every value the providers document today is translated,
 * unknown future values fall back to "stop" instead of rejecting the reply, and the
 * provider's original value is kept in `provider_finish_reason`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete } from "../src/rezunateLlmSdk/gateway";
import { mapFinishReason } from "../src/rezunateLlmSdk/models";
import {
  ANTHROPIC_STOP_REASONS,
  AnthropicResponseSchema,
} from "../src/rezunateLlmSdk/providers/anthropicModels";
import { AnthropicProvider } from "../src/rezunateLlmSdk/providers/anthropicProvider";
import {
  GOOGLE_FINISH_REASONS,
  GoogleResponseSchema,
} from "../src/rezunateLlmSdk/providers/googleModels";
import { GoogleProvider } from "../src/rezunateLlmSdk/providers/googleProvider";
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

const UNKNOWN = "SOME_FUTURE_REASON";

describe("mapFinishReason", () => {
  it.each([
    ["refusal", "content_filter"],
    ["model_context_window_exceeded", "length"],
    ["pause_turn", "stop"],
    ["UNEXPECTED_TOOL_CALL", "stop"],
    ["TOO_MANY_TOOL_CALLS", "stop"],
    ["CONTINUATION", "length"],
    ["LANGUAGE", "stop"],
    ["FINISH_REASON_UNSPECIFIED", "stop"],
    ["aborted", "stop"],
  ])("translates the new value %s to %s", (reason, expected) => {
    expect(mapFinishReason(reason)).toBe(expected);
  });

  it.each([
    ["end_turn", "stop"],
    ["max_tokens", "length"],
    ["tool_use", "tool_calls"],
    ["SAFETY", "content_filter"],
    ["MAX_TOKENS", "length"],
    ["insufficient_system_resource", "stop"],
  ])("keeps translating the existing value %s to %s", (reason, expected) => {
    expect(mapFinishReason(reason)).toBe(expected);
  });

  it.each([
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
    "IMAGE_OTHER",
    "NO_IMAGE",
  ])("does not translate the image-only Gemini value %s (the SDK is text-only)", (reason) => {
    expect(mapFinishReason(reason)).toBe("stop");
  });

  it("falls back to stop for an unknown or missing value", () => {
    expect(mapFinishReason(UNKNOWN)).toBe("stop");
    expect(mapFinishReason(null)).toBe("stop");
    expect(mapFinishReason(undefined)).toBe("stop");
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "falls back to stop for the built-in object name %s",
    (reason) => {
      expect(mapFinishReason(reason)).toBe("stop");
    },
  );
});

describe("Anthropic stop reasons", () => {
  const provider = new AnthropicProvider({ apiKey: mockApiKey });

  it.each([...ANTHROPIC_STOP_REASONS])("accepts %s and keeps the original value", (reason) => {
    const result = provider.transformResponse(
      AnthropicResponseSchema.parse({ ...anthropicResponse(), stop_reason: reason }),
    );

    expect(result.choices[0]?.finish_reason).toBe(mapFinishReason(reason));
    expect(result.choices[0]?.provider_finish_reason).toBe(reason);
  });

  it("returns the answer for an unknown stop reason instead of an error", async () => {
    mockFetch({ json: { ...anthropicResponse(), stop_reason: UNKNOWN } });

    const result = await chatComplete({
      provider: "anthropic",
      apiKey: mockApiKey,
      request: { model: "claude-haiku-4-5", messages: [{ role: "user", content: "Hi" }] },
    });

    expect(result.error).toBeNull();
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.choices[0]?.finish_reason).toBe("stop");
    expect(result.choices[0]?.provider_finish_reason).toBe(UNKNOWN);
  });
});

describe("Gemini finish reasons", () => {
  const provider = new GoogleProvider({ apiKey: mockApiKey });

  /** A Gemini response whose candidate has the given finish reason. */
  function withReason(reason: string) {
    const response = googleResponse();
    return { ...response, candidates: [{ ...response.candidates[0], finishReason: reason }] };
  }

  it.each([...GOOGLE_FINISH_REASONS])("accepts %s and keeps the original value", (reason) => {
    const result = provider.transformResponse(GoogleResponseSchema.parse(withReason(reason)));

    expect(result.choices[0]?.finish_reason).toBe(mapFinishReason(reason));
    expect(result.choices[0]?.provider_finish_reason).toBe(reason);
  });

  it("returns the answer for an unknown finish reason instead of an error", async () => {
    mockFetch({ json: withReason(UNKNOWN) });

    const result = await chatComplete({
      provider: "google",
      apiKey: mockApiKey,
      request: { model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }] },
    });

    expect(result.error).toBeNull();
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.choices[0]?.finish_reason).toBe("stop");
    expect(result.choices[0]?.provider_finish_reason).toBe(UNKNOWN);
  });
});

describe("OpenAI-compatible finish reasons", () => {
  /** A response whose only choice has the given finish reason. */
  function withReason(response: ReturnType<typeof openaiResponse>, reason: string | null) {
    return { ...response, choices: [{ ...response.choices[0], finish_reason: reason }] };
  }

  it.each([
    ["openai", "gpt-4", openaiResponse(), UNKNOWN, "stop"],
    ["grok", "grok-3-mini", grokResponse(), UNKNOWN, "stop"],
    ["deepseek", "deepseek-chat", deepseekResponse(), "aborted", "stop"],
    ["deepseek", "deepseek-chat", deepseekResponse(), "insufficient_system_resource", "stop"],
    ["meta", "muse-spark-1.3", metaResponse(), "function_call", "stop"],
    ["openai", "gpt-4", openaiResponse(), "content_filter", "content_filter"],
  ])("%s: %s → %s, original kept", async (provider, model, response, reason, expected) => {
    mockFetch({ json: withReason(response, reason) });

    const result = await chatComplete({
      provider,
      apiKey: mockApiKey,
      request: { model, messages: [{ role: "user", content: "Hi" }] },
    });

    expect(result.error).toBeNull();
    expect(result.choices[0]?.finish_reason).toBe(expected);
    expect(result.choices[0]?.provider_finish_reason).toBe(reason);
  });

  it("leaves a missing finish reason empty", async () => {
    mockFetch({ json: withReason(openaiResponse(), null) });

    const result = await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: { model: "gpt-4", messages: [{ role: "user", content: "Hi" }] },
    });

    expect(result.choices[0]?.finish_reason).toBeNull();
    expect(result.choices[0]?.provider_finish_reason).toBeNull();
  });
});

describe("Qwen finish reasons", () => {
  it("returns the answer for an unknown finish reason and keeps the original value", async () => {
    const response = qwenResponse();
    response.output.choices[0] = { ...response.output.choices[0], finish_reason: UNKNOWN } as never;
    mockFetch({ json: response });

    const result = await chatComplete({
      provider: "qwen",
      apiKey: mockApiKey,
      request: { model: "qwen-plus", messages: [{ role: "user", content: "Hi" }] },
    });

    expect(result.error).toBeNull();
    expect(result.choices[0]?.finish_reason).toBe("stop");
    expect(result.choices[0]?.provider_finish_reason).toBe(UNKNOWN);
  });
});
