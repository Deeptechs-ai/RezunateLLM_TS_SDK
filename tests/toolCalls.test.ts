/**
 * Tool-call round-trip tests across providers, ported from the Python `tests/test_tool_calls.py`.
 * Added in the TS port: the OpenAI-compatible pass-through.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatComplete } from "../src/rezunateLlmSdk/gateway";
import { ChatCompletionRequestSchema, MessageSchema, Role } from "../src/rezunateLlmSdk/models";
import { AnthropicProvider } from "../src/rezunateLlmSdk/providers/anthropicProvider";
import { dropNones } from "../src/rezunateLlmSdk/providers/base";
import { GoogleProvider } from "../src/rezunateLlmSdk/providers/googleProvider";
import { mockApiKey, mockFetch, openaiResponse, qwenResponse } from "./fixtures";

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

describe("Anthropic tool calls", () => {
  const anthropic = () => new AnthropicProvider({ apiKey: mockApiKey });

  it("translates OpenAI tools and tool_choice", () => {
    const request = ChatCompletionRequestSchema.parse({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      tools: [weatherTool],
      tool_choice: "required",
    });

    const out = anthropic().transformRequest(request);

    expect(out.tools).toEqual([
      {
        name: "get_weather",
        description: "Get the weather for a city",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
    expect(out.tool_choice).toEqual({ type: "any" });
  });

  it("translates a tool_choice for a specific function", () => {
    const request = ChatCompletionRequestSchema.parse({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });

    expect(anthropic().transformRequest(request).tool_choice).toEqual({
      type: "tool",
      name: "get_weather",
    });
  });

  it("sends assistant tool calls as tool_use blocks and tool messages as tool_result", () => {
    const request = ChatCompletionRequestSchema.parse({
      model: "claude-sonnet-4-5",
      messages: [
        { role: "user", content: "What's the weather in Tokyo?" },
        {
          role: "assistant",
          content: "I'll check.",
          tool_calls: [
            { id: "toolu_1", function: { name: "get_weather", arguments: '{"city":"Tokyo"}' } },
          ],
        },
        { role: "tool", content: "sunny, 22C", tool_call_id: "toolu_1" },
      ],
    });

    const out = anthropic().transformRequest(request);

    expect(out.messages).toEqual([
      { role: "user", content: "What's the weather in Tokyo?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll check." },
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Tokyo" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "sunny, 22C" }],
      },
    ]);
  });

  it("returns tool_use blocks as tool calls", () => {
    const result = anthropic().transformResponse(
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_xyz", name: "get_weather", input: { city: "Tokyo" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 30, output_tokens: 12 },
      },
      "claude-sonnet-4-5",
    );

    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
    expect(result.choices[0]?.provider_finish_reason).toBe("tool_use");
    const msg = result.choices[0]?.message;
    expect(msg?.content).toBe("Let me check.");
    expect(msg?.tool_calls).toHaveLength(1);
    expect(msg?.tool_calls?.[0]).toMatchObject({
      id: "toolu_xyz",
      type: "function",
      function: { name: "get_weather" },
    });
    expect(JSON.parse(msg?.tool_calls?.[0]?.function.arguments ?? "")).toEqual({ city: "Tokyo" });
  });
});

describe("Gemini tool calls", () => {
  const google = () => new GoogleProvider({ apiKey: mockApiKey });

  it("translates OpenAI tools into function declarations", () => {
    const request = ChatCompletionRequestSchema.parse({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
      tools: [weatherTool],
      tool_choice: "required",
    });

    const out = google().transformRequest(request);

    expect(out.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Get the weather for a city",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
      },
    ]);
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
  });

  it("translates a tool_choice for a specific function", () => {
    const request = ChatCompletionRequestSchema.parse({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });

    expect(google().transformRequest(request).toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["get_weather"] },
    });
  });

  it("sends assistant tool calls as functionCall and tool messages as functionResponse", () => {
    const request = ChatCompletionRequestSchema.parse({
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: "What's the weather in Tokyo?" },
        {
          role: "assistant",
          tool_calls: [
            { id: "call_xyz", function: { name: "get_weather", arguments: '{"city":"Tokyo"}' } },
          ],
        },
        {
          role: "tool",
          content: '{"temp":"22C"}',
          tool_call_id: "call_xyz",
          name: "get_weather",
        },
      ],
    });

    const out = google().transformRequest(request);

    expect(out.contents).toEqual([
      { role: "user", parts: [{ text: "What's the weather in Tokyo?" }] },
      {
        role: "model",
        parts: [{ functionCall: { name: "get_weather", args: { city: "Tokyo" } } }],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "get_weather", response: { temp: "22C" } } }],
      },
    ]);
  });

  it("returns functionCall parts as tool calls", () => {
    const result = google().transformResponse(
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { text: "Looking it up." },
                { functionCall: { name: "get_weather", args: { city: "Tokyo" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
      "gemini-2.5-flash",
    );

    const msg = result.choices[0]?.message;
    expect(msg?.content).toBe("Looking it up.");
    expect(msg?.tool_calls).toHaveLength(1);
    expect(msg?.tool_calls?.[0]).toMatchObject({
      type: "function",
      function: { name: "get_weather" },
    });
    expect(msg?.tool_calls?.[0]?.id).toMatch(/^call_[0-9a-f]{8}$/);
    expect(JSON.parse(msg?.tool_calls?.[0]?.function.arguments ?? "")).toEqual({ city: "Tokyo" });
    // Forced to tool_calls when functionCall parts are present; Gemini's own "STOP" is kept.
    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
    expect(result.choices[0]?.provider_finish_reason).toBe("STOP");
  });
});

// New in the TS port: the Python SDK drops tools on Qwen.
describe("Qwen tool calls", () => {
  it("sends tools under parameters, with tool calls and tool messages unchanged", async () => {
    const fetch = mockFetch({ json: qwenResponse() });

    await chatComplete({
      provider: "qwen",
      apiKey: mockApiKey,
      request: {
        model: "qwen-plus",
        messages: [
          { role: "user", content: "Weather in Paris?" },
          { role: "assistant", tool_calls: [weatherCall] },
          { role: "tool", content: '{"temp":18}', tool_call_id: "call_1" },
        ],
        tools: [weatherTool],
        tool_choice: { type: "function", function: { name: "get_weather" } },
        parallel_tool_calls: true,
      },
    });

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.input.messages.slice(1)).toEqual([
      { role: "assistant", content: "", tool_calls: [weatherCall] },
      { role: "tool", content: '{"temp":18}', tool_call_id: "call_1" },
    ]);
    expect(body.parameters).toMatchObject({
      result_format: "message",
      tools: [weatherTool],
      tool_choice: { type: "function", function: { name: "get_weather" } },
      parallel_tool_calls: true,
    });
  });

  it("returns the tool calls from the reply", async () => {
    mockFetch({
      json: {
        output: {
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{ ...weatherCall, index: 0 }],
              },
            },
          ],
        },
        usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
        request_id: "req-1",
      },
    });

    const result = await chatComplete({
      provider: "qwen",
      apiKey: mockApiKey,
      request: {
        model: "qwen-plus",
        messages: [{ role: "user", content: "Hi" }],
        tools: [weatherTool],
      },
    });

    expect(result.choices[0]?.message.tool_calls).toEqual([weatherCall]);
    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
    expect(result.choices[0]?.provider_finish_reason).toBe("tool_calls");
  });
});
