/** Tests for the Google (Gemini) provider, ported from the Python `tests/test_google_provider.py`. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCompletionRequestSchema } from "../src/rezunateLlmSdk/models";
import { GoogleResponseSchema } from "../src/rezunateLlmSdk/providers/googleModels";
import { GoogleProvider } from "../src/rezunateLlmSdk/providers/googleProvider";
import {
  googleResponse,
  mockApiKey,
  mockFetch,
  sampleConversation,
  sampleMessages,
} from "./fixtures";

const MODEL = "gemini-2.0-flash";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(fields: Record<string, unknown>) {
  return ChatCompletionRequestSchema.parse({ model: MODEL, ...fields });
}

const hello = [{ role: "user", content: "Hello!" }];

/** A Gemini response with one candidate per `[text, finishReason]` pair. */
function responseWith(candidates: [string, string][], usage: [number, number, number]) {
  return GoogleResponseSchema.parse({
    candidates: candidates.map(([text, finishReason]) => ({
      content: { parts: [{ text }], role: "model" },
      finishReason,
    })),
    usageMetadata: {
      promptTokenCount: usage[0],
      candidatesTokenCount: usage[1],
      totalTokenCount: usage[2],
    },
  });
}

describe("Google provider properties", () => {
  it("has the correct base URL", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });
    expect(provider.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("has the correct provider name", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });
    expect(provider.providerName).toBe("google");
  });

  it("includes the model name in the endpoint", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });
    expect(provider.getEndpoint(MODEL)).toBe("/models/gemini-2.0-flash:generateContent");
  });

  it("includes the API key in the headers", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });
    const headers = provider.getHeaders();

    expect(headers["x-goog-api-key"]).toBe(mockApiKey);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("Google request transformation", () => {
  it("transforms a basic request", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: hello }));

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.role).toBe("user");
    expect(result.contents[0]?.parts[0]?.text).toBe("Hello!");
  });

  it("extracts the system message to systemInstruction", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: sampleMessages() }));

    expect(result.systemInstruction?.parts[0]?.text).toBe("You are a helpful assistant.");
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.role).toBe("user");
  });

  it("maps assistant to model", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: sampleConversation() }));

    expect(result.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("adds temperature to generationConfig", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: hello, temperature: 0.7 }));

    expect(result.generationConfig?.temperature).toBe(0.7);
  });

  it("maps max_tokens to maxOutputTokens", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: hello, max_tokens: 100 }));

    expect(result.generationConfig?.maxOutputTokens).toBe(100);
  });

  it("adds top_k to generationConfig", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformRequest(request({ messages: hello, top_k: 40 }));

    expect(result.generationConfig?.topK).toBe(40);
  });

  it("passes safety_settings through", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });
    const safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ];

    const result = provider.transformRequest(
      request({ messages: hello, safety_settings: safetySettings }),
    );

    expect(result.safetySettings).toEqual(safetySettings);
  });
});

describe("Google response transformation", () => {
  it("transforms a basic response", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(GoogleResponseSchema.parse(googleResponse()), MODEL);

    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe(MODEL);
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0]?.message.role).toBe("assistant");
    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
  });

  it("maps STOP to stop", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(responseWith([["Done", "STOP"]], [10, 5, 15]), MODEL);

    expect(result.choices[0]?.finish_reason).toBe("stop");
  });

  it("maps MAX_TOKENS to length", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith([["Truncated", "MAX_TOKENS"]], [10, 100, 110]),
      MODEL,
    );

    expect(result.choices[0]?.finish_reason).toBe("length");
  });

  it("maps SAFETY to content_filter", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(responseWith([["", "SAFETY"]], [10, 0, 10]), MODEL);

    expect(result.choices[0]?.finish_reason).toBe("content_filter");
  });

  it("transforms usage", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(GoogleResponseSchema.parse(googleResponse()), MODEL);

    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(20);
    expect(result.usage.total_tokens).toBe(30);
  });

  it("transforms multiple candidates to choices", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(
      responseWith(
        [
          ["Response 1", "STOP"],
          ["Response 2", "STOP"],
        ],
        [10, 20, 30],
      ),
      MODEL,
    );

    expect(result.choices).toHaveLength(2);
    expect(result.choices[0]?.index).toBe(0);
    expect(result.choices[0]?.message.content).toBe("Response 1");
    expect(result.choices[1]?.index).toBe(1);
    expect(result.choices[1]?.message.content).toBe("Response 2");
  });

  it("concatenates multiple text parts", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });
    const response = GoogleResponseSchema.parse({
      candidates: [
        {
          content: { parts: [{ text: "First " }, { text: "Second" }], role: "model" },
          finishReason: "STOP",
        },
      ],
    });

    const result = provider.transformResponse(response, MODEL);

    expect(result.choices[0]?.message.content).toBe("First Second");
  });

  it("includes a created timestamp", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(GoogleResponseSchema.parse(googleResponse()), MODEL);

    expect(result.created).toBeGreaterThan(0);
    expect(Number.isInteger(result.created)).toBe(true);
  });

  it("generates a response id", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = provider.transformResponse(GoogleResponseSchema.parse(googleResponse()), MODEL);

    expect(result.id).toMatch(/^chatcmpl-/);
  });

  // Known difference from Python (issue #7): these reasons are rejected there.
  it("accepts the blocking finish reasons that FINISH_REASON_MAP handles", () => {
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    for (const [reason, expected] of [
      ["BLOCKLIST", "content_filter"],
      ["PROHIBITED_CONTENT", "content_filter"],
      ["SPII", "content_filter"],
      ["MALFORMED_FUNCTION_CALL", "stop"],
    ]) {
      const result = provider.transformResponse(
        responseWith([["", reason as string]], [10, 0, 10]),
        MODEL,
      );
      expect(result.choices[0]?.finish_reason).toBe(expected);
    }
  });
});

describe("Google integration", () => {
  it("completes a full chat completion", async () => {
    const fetch = mockFetch({ json: googleResponse() });
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    const result = await provider.chatComplete(request({ messages: sampleMessages() }));

    expect(result.choices[0]?.message.content).toBe("Hello! How can I assist you today?");
    expect(result.provider).toBe("google");
    expect(fetch.mock.calls[0]?.[0]).toBe(URL);
  });

  it("sends the request body in Google format", async () => {
    const fetch = mockFetch({ json: googleResponse() });
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    await provider.chatComplete(request({ messages: sampleMessages() }));

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toHaveProperty("contents");
    expect(body).toHaveProperty("systemInstruction");
  });

  it("sends the API key in a header, not in the URL", async () => {
    const fetch = mockFetch({ json: googleResponse() });
    const provider = new GoogleProvider({ apiKey: mockApiKey });

    await provider.chatComplete(request({ messages: hello }));

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-goog-api-key")).toBe(mockApiKey);
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("key=");
  });
});
