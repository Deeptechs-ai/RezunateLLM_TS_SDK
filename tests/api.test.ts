/**
 * Tests for the Rezunate LLM API endpoints (getPrompt).
 * New in the TS port: the Python SDK has no tests for `api.py`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrompt } from "../src/rezunateLlmSdk/api";
import { RouterAPIError, RouterClient } from "../src/rezunateLlmSdk/client";
import { mockApiKey, mockFetch, promptResponse } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () => new RouterClient({ apiKey: mockApiKey });

describe("getPrompt", () => {
  it("fetches the current version of a prompt by its slug", async () => {
    const fetch = mockFetch({ json: promptResponse() });

    const prompt = await getPrompt(client(), "customer_support_reply");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://rezunatellm.com/api/v1/prompts/customer_support_reply",
    );
    expect(prompt).toMatchObject({
      slug_id: "customer_support_reply",
      current_version: 2,
      input_variables: ["company_name", "customer_name", "tone"],
    });
    expect(prompt.created_at).toEqual(new Date("2026-05-18T15:28:33.494766Z"));
  });

  it("asks for a specific version and encodes the slug", async () => {
    const fetch = mockFetch({ json: promptResponse() });

    await getPrompt(client(), "a/b?c", 1);

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://rezunatellm.com/api/v1/prompts/a%2Fb%3Fc?version=1",
    );
  });

  it("throws RouterAPIError when the prompt does not exist", async () => {
    mockFetch({ json: { detail: "Prompt not found" }, status: 404 });

    await expect(getPrompt(client(), "missing")).rejects.toThrow(RouterAPIError);
  });
});
