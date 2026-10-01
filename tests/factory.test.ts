/** Tests for the provider factory, ported from the Python `tests/test_factory.py`. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Provider } from "../src/rezunateLlmSdk/models";
import { AnthropicProvider } from "../src/rezunateLlmSdk/providers/anthropicProvider";
import type { BaseProvider } from "../src/rezunateLlmSdk/providers/base";
import { DeepSeekProvider } from "../src/rezunateLlmSdk/providers/deepseekProvider";
import {
  AnthropicFactory,
  DeepSeekFactory,
  FACTORY_REGISTRY,
  GoogleFactory,
  GrokFactory,
  getFactory,
  LlamaFactory,
  OpenAIFactory,
  ProviderFactory,
  QwenFactory,
  registerFactory,
} from "../src/rezunateLlmSdk/providers/factory";
import { GoogleProvider } from "../src/rezunateLlmSdk/providers/googleProvider";
import { GrokProvider } from "../src/rezunateLlmSdk/providers/grokProvider";
import { LlamaProvider } from "../src/rezunateLlmSdk/providers/llamaProvider";
import { OpenAIProvider } from "../src/rezunateLlmSdk/providers/openaiProvider";
import { QwenProvider } from "../src/rezunateLlmSdk/providers/qwenProvider";
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
  it("contains all providers", () => {
    expect(FACTORY_REGISTRY.has(Provider.OPENAI)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.ANTHROPIC)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.GOOGLE)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.GROK)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.LLAMA)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.DEEPSEEK)).toBe(true);
    expect(FACTORY_REGISTRY.has(Provider.QWEN)).toBe(true);
  });

  it("contains factory instances, not classes", () => {
    expect(FACTORY_REGISTRY.get(Provider.OPENAI)).toBeInstanceOf(OpenAIFactory);
    expect(FACTORY_REGISTRY.get(Provider.ANTHROPIC)).toBeInstanceOf(AnthropicFactory);
    expect(FACTORY_REGISTRY.get(Provider.GOOGLE)).toBeInstanceOf(GoogleFactory);
    expect(FACTORY_REGISTRY.get(Provider.GROK)).toBeInstanceOf(GrokFactory);
    expect(FACTORY_REGISTRY.get(Provider.LLAMA)).toBeInstanceOf(LlamaFactory);
    expect(FACTORY_REGISTRY.get(Provider.DEEPSEEK)).toBeInstanceOf(DeepSeekFactory);
    expect(FACTORY_REGISTRY.get(Provider.QWEN)).toBeInstanceOf(QwenFactory);
  });
});

describe("getFactory", () => {
  it("returns the OpenAI factory", () => {
    expect(getFactory(Provider.OPENAI)).toBeInstanceOf(OpenAIFactory);
  });

  it("returns the Anthropic factory", () => {
    expect(getFactory(Provider.ANTHROPIC)).toBeInstanceOf(AnthropicFactory);
  });

  it("returns the Google factory", () => {
    expect(getFactory(Provider.GOOGLE)).toBeInstanceOf(GoogleFactory);
  });

  it("returns the Grok factory", () => {
    expect(getFactory(Provider.GROK)).toBeInstanceOf(GrokFactory);
  });

  it("returns the Llama factory", () => {
    expect(getFactory(Provider.LLAMA)).toBeInstanceOf(LlamaFactory);
  });

  it("returns the DeepSeek factory", () => {
    expect(getFactory(Provider.DEEPSEEK)).toBeInstanceOf(DeepSeekFactory);
  });

  it("returns the Qwen factory", () => {
    expect(getFactory(Provider.QWEN)).toBeInstanceOf(QwenFactory);
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

describe("AnthropicFactory", () => {
  it("returns the correct provider name", () => {
    expect(new AnthropicFactory().providerName).toBe(Provider.ANTHROPIC);
  });

  it("creates an Anthropic provider", () => {
    const provider = new AnthropicFactory().createProvider(mockApiKey);

    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = new AnthropicFactory().createProvider(mockApiKey, {
      maxRetries: 10,
      retryDelay: 2.0,
    });

    expect(provider.maxRetries).toBe(10);
    expect(provider.retryDelay).toBe(2.0);
  });
});

describe("GoogleFactory", () => {
  it("returns the correct provider name", () => {
    expect(new GoogleFactory().providerName).toBe(Provider.GOOGLE);
  });

  it("creates a Google provider", () => {
    const provider = new GoogleFactory().createProvider(mockApiKey);

    expect(provider).toBeInstanceOf(GoogleProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = new GoogleFactory().createProvider(mockApiKey, { timeout: 120.0 });

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

describe("LlamaFactory", () => {
  it("returns the correct provider name", () => {
    expect(new LlamaFactory().providerName).toBe(Provider.LLAMA);
  });

  it("creates a Llama provider", () => {
    const provider = new LlamaFactory().createProvider(mockApiKey);

    expect(provider).toBeInstanceOf(LlamaProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = new LlamaFactory().createProvider(mockApiKey, {
      maxRetries: 4,
      timeout: 90.0,
    });

    expect(provider.maxRetries).toBe(4);
    expect(provider.timeout).toBe(90.0);
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

describe("QwenFactory", () => {
  it("returns the correct provider name", () => {
    expect(new QwenFactory().providerName).toBe(Provider.QWEN);
  });

  it("creates a Qwen provider", () => {
    const provider = new QwenFactory().createProvider(mockApiKey);

    expect(provider).toBeInstanceOf(QwenProvider);
    expect(provider.apiKey).toBe(mockApiKey);
  });

  it("passes settings to the provider", () => {
    const provider = new QwenFactory().createProvider(mockApiKey, {
      maxRetries: 3,
      timeout: 60.0,
    });

    expect(provider.maxRetries).toBe(3);
    expect(provider.timeout).toBe(60.0);
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
