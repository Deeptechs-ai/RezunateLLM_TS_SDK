/**
 * Tests for RouterClient (the Rezunate LLM API client).
 * New in the TS port: the Python SDK has no tests for `client.py`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterAPIError, RouterClient } from "../src/rezunateLlmSdk/client";
import { mockApiKey, mockFetch } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A fetch that always answers with the given body and status. */
function replyWith(body: string, status: number) {
  const fetch = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A fetch that always throws the given error. */
function failWith(error: Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw error;
    }),
  );
}

describe("RouterClient", () => {
  it("requires an API key", () => {
    vi.stubEnv("REZUNATE_LLM_API_KEY", "");

    expect(() => new RouterClient()).toThrow(RouterAPIError);
    expect(() => new RouterClient()).toThrow(
      "apiKey is required (or set REZUNATE_LLM_API_KEY env var)",
    );
  });

  it("reads the API key and base URL from the environment", () => {
    vi.stubEnv("REZUNATE_LLM_API_KEY", "rk_live_from_env");
    vi.stubEnv("REZUNATE_LLM_BASE_URL", "http://localhost:8000");

    const client = new RouterClient();

    expect(client.apiKey).toBe("rk_live_from_env");
    expect(client.baseUrl).toBe("http://localhost:8000");
    expect(client.timeout).toBe(30);
  });

  it("sends the request with the API key and query parameters", async () => {
    const fetch = mockFetch({ json: { ok: true } });

    const response = await new RouterClient({ apiKey: mockApiKey }).request(
      "GET",
      "/api/v1/prompts/greeting",
      { params: { version: 2, unused: undefined } },
    );

    expect(await response.json()).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://rezunatellm.com/api/v1/prompts/greeting?version=2");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({ "x-api-key": mockApiKey });
  });

  it("throws the server's detail message with the status code", async () => {
    replyWith(JSON.stringify({ detail: "Prompt not found" }), 404);

    const error = await new RouterClient({ apiKey: mockApiKey })
      .request("GET", "/api/v1/prompts/missing")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RouterAPIError);
    expect(error).toMatchObject({ message: "Prompt not found", statusCode: 404 });
  });

  it("summarizes a non-JSON error page instead of returning the HTML", async () => {
    replyWith("<html><body>504 Gateway Time-out</body></html>", 504);

    await expect(
      new RouterClient({ apiKey: mockApiKey }).request("GET", "/api/v1/prompts/x"),
    ).rejects.toMatchObject({ message: "HTTP 504 Gateway Timeout", statusCode: 504 });
  });

  it("reports a network failure as a connection error", async () => {
    failWith(new TypeError("fetch failed"));

    await expect(
      new RouterClient({ apiKey: mockApiKey }).request("GET", "/api/v1/prompts/x"),
    ).rejects.toMatchObject({
      message: "Cannot connect to Rezunate LLM API at https://rezunatellm.com",
      statusCode: null,
    });
  });

  it("reports a timeout with the method and path", async () => {
    failWith(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    await expect(
      new RouterClient({ apiKey: mockApiKey, timeout: 5 }).request("GET", "/api/v1/prompts/x"),
    ).rejects.toMatchObject({
      message: "Rezunate LLM API request timed out after 5s: GET /api/v1/prompts/x",
    });
  });
});
