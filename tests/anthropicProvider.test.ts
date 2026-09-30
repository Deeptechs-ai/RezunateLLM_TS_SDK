/** Tests for the Anthropic provider, ported from the Python `tests/test_anthropic_provider.py`. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema } from "../src/models";
import { AnthropicResponseSchema } from "../src/providers/anthropicModels";
import { AnthropicProvider } from "../src/providers/anthropicProvider";
import {
  anthropicResponse,
  mockApiKey,
  mockFetch,
  sampleConversation,
  sampleMessages,
} from "./fixtures";

const MODEL = "claude-sonnet-4-20250514";
const URL = "https://api.anthropic.com/v1/messages";

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(fields: Record<string, unknown>) {
  return ChatCompletionRequestSchema.parse({ model: MODEL, ...fields });
}

/** An Anthropic response with the given content blocks and stop reason. */
function responseWith(content: unknown[], stopReason: string, outputTokens: number) {
  return AnthropicResponseSchema.parse({
    id: "msg_123",
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: outputTokens },
  });
}

describe("Anthropic provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://api.anthropic.com/v1");
  });

  it("has the correct provider name", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe("anthropic");
  });

  it("has the correct endpoint", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint()).toBe("/messages");
  });

  it("includes the API key and version in the headers", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers["x-api-key"]).toBe(mockApiKey);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers).toHaveProperty("anthropic-version");
  });
});

describe("Anthropic request transformation", () => {
  it("transforms a basic request", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ messages: [{ role: "user", content: "Hello!" }], max_tokens: 100 }),
    );

    expect(result.model).toBe(MODEL);
    expect(result.max_tokens).toBe(100);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect(result.messages[0]?.content).toBe("Hello!");
  });

  it("extracts the system message to a separate field", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ messages: sampleMessages(), max_tokens: 100 }),
    );

    expect(result.system).toBe("You are a helpful assistant.");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect(result.messages[0]?.content).toBe("Hello!");
  });

  it("sets a default max_tokens when not provided", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ messages: [{ role: "user", content: "Hello!" }] }),
    );

    expect(result.max_tokens).toBe(1024);
  });

  it("passes temperature through", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({ messages: [{ role: "user", content: "Hello!" }], temperature: 0.7 }),
    );

    expect(result.temperature).toBe(0.7);
  });

  it("maps conversation roles", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: sampleConversation() }));

    expect(result.system).toBe("You are a helpful assistant.");
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("passes Anthropic-specific parameters through", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(
      request({
        messages: [{ role: "user", content: "Hello!" }],
        top_k: 40,
        metadata: { user_id: "123" },
      }),
    );

    expect(result.top_k).toBe(40);
    expect(result.metadata).toEqual({ user_id: "123" });
  });
});

describe("Anthropic response transformation", () => {
  it("transforms a basic response", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(AnthropicResponseSchema.parse(anthropicResponse()));

    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe(MODEL);
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0]?.message.role).toBe("assistant");
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
  });

  it("maps stop reason end_turn to stop", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith([{ type: "text", text: "Done" }], "end_turn", 5),
    );

    expect(result.choices[0]?.finish_reason).toBe("stop");
  });

  it("maps stop reason max_tokens to length", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith([{ type: "text", text: "Truncated..." }], "max_tokens", 100),
    );

    expect(result.choices[0]?.finish_reason).toBe("length");
  });

  it("maps stop reason tool_use to tool_calls", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith([{ type: "text", text: "Using tool" }], "tool_use", 20),
    );

    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("transforms usage", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(AnthropicResponseSchema.parse(anthropicResponse()));

    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(20);
    expect(result.usage.total_tokens).toBe(30);
  });

  it("concatenates multiple text blocks", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith(
        [
          { type: "text", text: "First part. " },
          { type: "text", text: "Second part." },
        ],
        "end_turn",
        20,
      ),
    );

    expect(result.choices[0]?.message.content).toBe("First part. Second part.");
  });

  it("includes a created timestamp", () => {
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(AnthropicResponseSchema.parse(anthropicResponse()));

    expect(result.created).toBeGreaterThan(0);
    expect(Number.isInteger(result.created)).toBe(true);
  });
});

describe("Anthropic integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: anthropicResponse() });
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(
      request({ messages: sampleMessages(), max_tokens: 100 }),
    );

    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.provider).toBe("anthropic");
    expect(fetch.mock.calls[0]?.[0]).toBe(URL);
  });

  it("sends the request body in Anthropic format", async () => {
    const fetch = mockFetch({ json: anthropicResponse() });
    const provider = new AnthropicProvider({ apiKey: mockApiKey });

    await provider.chatComplete(request({ messages: sampleMessages(), max_tokens: 100 }));

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.system).toBe("You are a helpful assistant.");
  });
});
