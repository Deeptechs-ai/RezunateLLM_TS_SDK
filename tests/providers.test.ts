/** Tests for `getProvider` and `listProviders` (no direct Python tests; covered there via the gateway). */

import { describe, expect, it } from "vitest";
import { getProvider, listProviders, OpenAIProvider } from "../src/providers";
import { mockApiKey } from "./fixtures";

describe("getProvider", () => {
  it("creates a provider by name", () => {
    const provider = getProvider("openai", mockApiKey);

    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = getProvider("openai", mockApiKey, { maxRetries: 5, timeout: 30.0 });

    expect(provider.maxRetries).toBe(5);
    expect(provider.timeout).toBe(30.0);
  });

  it("throws for an unknown provider", () => {
    expect(() => getProvider("unknown", mockApiKey)).toThrow("Unknown provider: 'unknown'");
  });
});

describe("listProviders", () => {
  it("returns the registered provider names", () => {
    expect(listProviders()).toContain("openai");
  });
});
