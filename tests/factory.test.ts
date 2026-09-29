/** Tests for the provider factory, ported from the Python `tests/test_factory.py`. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Provider } from "../src/models";
import type { BaseProvider } from "../src/providers/base";
import { DeepSeekProvider } from "../src/providers/deepseekProvider";
import {
  DeepSeekFactory,
  FACTORY_REGISTRY,
  GrokFactory,
  getFactory,
  OpenAIFactory,
  ProviderFactory,
  registerFactory,
} from "../src/providers/factory";
import { GrokProvider } from "../src/providers/grokProvider";
import { OpenAIProvider } from "../src/providers/openaiProvider";
import { mockApiKey } from "./fixtures";

/** A factory used to test registering; creates OpenAI providers. */
class MockFactory extends ProviderFactory {
  get providerName(): Provider {
    return Provider.OPENAI;
  }

  createProvider(apiKey: string): BaseProvider {
    return new OpenAIProvider({ apiKey });
  }
}

// Save and restore the registry around each test (Python `clean_registry` fixture).
let originalRegistry: Map<string, ProviderFactory>;
beforeEach(() => {
  originalRegistry = new Map(FACTORY_REGISTRY);
});
afterEach(() => {
  FACTORY_REGISTRY.clear();
  for (const [name, factory] of originalRegistry) {
    FACTORY_REGISTRY.set(name, factory);
  }
});

describe("factory registry", () => {
  it("contains the ported providers", () => {
    expect(FACTORY_REGISTRY.has(Provider.OPENAI)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.GROK)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.DEEPSEEK)).toBe(true);
  });

  it("contains factory instances, not classes", () => {
    expect(FACTORY_REGISTRY.get(Provider.OPENAI)).toBeInstanceOf(OpenAIFactory);
    expect(FACTORY_REGISTRY.get(Provider.GROK)).toBeInstanceOf(GrokFactory);
    expect(FACTORY_REGISTRY.get(Provider.DEEPSEEK)).toBeInstanceOf(DeepSeekFactory);
  });
});

describe("getFactory", () => {
  it("returns the OpenAI factory", () => {
    expect(getFactory(Provider.OPENAI)).toBeInstanceOf(OpenAIFactory);
  });

  it("returns the Grok factory", () => {
    expect(getFactory(Provider.GROK)).toBeInstanceOf(GrokFactory);
  });

  it("returns the DeepSeek factory", () => {
    expect(getFactory(Provider.DEEPSEEK)).toBeInstanceOf(DeepSeekFactory);
  });

  it("ignores the case of the name", () => {
    expect(getFactory("OpenAI")).toBeInstanceOf(OpenAIFactory);
  });

  it("throws for an unknown provider", () => {
    expect(() => getFactory("unknown_provider")).toThrow("Unknown provider: 'unknown_provider'");
    expect(() => getFactory("unknown_provider")).toThrow("Available providers:");
  });

  it("lists the available providers in the error message", () => {
    expect(() => getFactory("invalid")).toThrow(/openai.*anthropic.*google/);
  });
});

describe("registerFactory", () => {
  it("registers a new factory", () => {
    const mockFactory = new MockFactory();
    registerFactory(Provider.OPENAI, mockFactory);

    expect(FACTORY_REGISTRY.has(Provider.OPENAI)).toBe(true);
    expect(getFactory(Provider.OPENAI)).toBe(mockFactory);
  });

  it("overwrites an existing factory", () => {
    const originalFactory = FACTORY_REGISTRY.get(Provider.OPENAI);
    const newFactory = new MockFactory();
    registerFactory(Provider.OPENAI, newFactory);

    expect(FACTORY_REGISTRY.get(Provider.OPENAI)).toBe(newFactory);
    expect(FACTORY_REGISTRY.get(Provider.OPENAI)).not.toBe(originalFactory);
  });

  it("stores a new name that getFactory still rejects, as in Python", () => {
    registerFactory("mistral", new MockFactory());

    expect(FACTORY_REGISTRY.has("mistral")).toBe(true);
    expect(() => getFactory("mistral")).toThrow("Unknown provider: 'mistral'");
  });
});

describe("OpenAIFactory", () => {
  it("returns the correct provider name", () => {
    expect(new OpenAIFactory().providerName).toBe(Provider.OPENAI);
  });

  it("creates an OpenAI provider", () => {
    const provider = new OpenAIFactory().createProvider(mockApiKey);

    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = new OpenAIFactory().createProvider(mockApiKey, {
      maxRetries: 5,
      timeout: 120.0,
    });

    expect(provider.maxRetries).toBe(5);
    expect(provider.timeout).toBe(120.0);
  });
});

describe("GrokFactory", () => {
  it("returns the correct provider name", () => {
    expect(new GrokFactory().providerName).toBe(Provider.GROK);
  });

  it("creates a Grok provider", () => {
    const provider = new GrokFactory().createProvider(mockApiKey);

    expect(provider).toBeInstanceOf(GrokProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = new GrokFactory().createProvider(mockApiKey, {
      maxRetries: 5,
      timeout: 120.0,
    });

    expect(provider.maxRetries).toBe(5);
    expect(provider.timeout).toBe(120.0);
  });
});

describe("DeepSeekFactory", () => {
  it("returns the correct provider name", () => {
    expect(new DeepSeekFactory().providerName).toBe(Provider.DEEPSEEK);
  });

  it("creates a DeepSeek provider", () => {
    const provider = new DeepSeekFactory().createProvider(mockApiKey);

    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = new DeepSeekFactory().createProvider(mockApiKey, {
      maxRetries: 2,
      timeout: 45.0,
    });

    expect(provider.maxRetries).toBe(2);
    expect(provider.timeout).toBe(45.0);
  });
});

describe("ProviderFactory abstract class", () => {
  it("cannot be instantiated directly", () => {
    const Abstract = ProviderFactory as unknown as new () => ProviderFactory;

    expect(() => new Abstract()).toThrow(TypeError);
  });

  // In TypeScript, missing abstract members are caught by the compiler (`pnpm typecheck`).
  it("requires createProvider", () => {
    // @ts-expect-error createProvider is not implemented
    class IncompleteFactory extends ProviderFactory {
      get providerName(): Provider {
        return Provider.OPENAI;
      }
    }
    expect(IncompleteFactory).toBeDefined();
  });

  it("requires providerName", () => {
    // @ts-expect-error providerName is not implemented
    class IncompleteFactory extends ProviderFactory {
      createProvider(apiKey: string): BaseProvider {
        return new OpenAIProvider({ apiKey });
      }
    }
    expect(IncompleteFactory).toBeDefined();
  });
});
