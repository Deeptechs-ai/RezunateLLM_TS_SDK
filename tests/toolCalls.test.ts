/**
 * Tool-call round-trip tests across providers, ported from the Python `tests/test_tool_calls.py`.
 * Added in the TS port: the OpenAI-compatible pass-through.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete } from "../src/rezunateLlmSdk/gateway";
import { MessageSchema, Role } from "../src/rezunateLlmSdk/models";
import { dropNones } from "../src/rezunateLlmSdk/providers/base";
import { mockApiKey, mockFetch, openaiResponse } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const weatherTool = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Get the weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } } },
  },
};

const weatherCall = {
  id: "call_1",
  type: "function" as const,
  function: { name: "get_weather", arguments: '{"city":"Paris"}' },
};

describe("tool models", () => {
  it("has the tool role", () => {
    expect(Role.TOOL).toBe("tool");
  });

  it("serializes an assistant message with tool calls", () => {
    const msg = MessageSchema.parse({
      role: "assistant",
      tool_calls: [{ id: "call_1", function: { name: "add", arguments: '{"a":1}' } }],
    });

    expect(dropNones(msg)).toEqual({
      role: "assistant",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "add", arguments: '{"a":1}' } },
      ],
    });
  });

  it("serializes a tool result message", () => {
    const msg = MessageSchema.parse({ role: "tool", content: "42", tool_call_id: "call_1" });

    expect(dropNones(msg)).toEqual({ role: "tool", content: "42", tool_call_id: "call_1" });
  });
});

describe("OpenAI-compatible tool calls", () => {
  it("sends tools, tool_choice and tool messages unchanged", async () => {
    const fetch = mockFetch({ json: openaiResponse() });

    await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: {
        model: "gpt-4",
        messages: [
          { role: "user", content: "Weather in Paris?" },
          { role: "assistant", tool_calls: [weatherCall] },
          { role: "tool", content: '{"temp":18}', tool_call_id: "call_1" },
        ],
        tools: [weatherTool],
        tool_choice: "auto",
      },
    });

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.tools).toEqual([weatherTool]);
    expect(body.tool_choice).toBe("auto");
    expect(body.messages.slice(1)).toEqual([
      { role: "assistant", tool_calls: [weatherCall] },
      { role: "tool", content: '{"temp":18}', tool_call_id: "call_1" },
    ]);
  });

  it("returns the tool calls from the reply", async () => {
    const response = openaiResponse();
    mockFetch({
      json: {
        ...response,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null, tool_calls: [weatherCall] },
            finish_reason: "tool_calls",
          },
        ],
      },
    });

    const result = await chatComplete({
      provider: "openai",
      apiKey: mockApiKey,
      request: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        tools: [weatherTool],
      },
    });

    expect(result.choices[0]?.message).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [weatherCall],
    });
    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
  });
});
