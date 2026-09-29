/**
 * Provider Factory - Factory Method Pattern.
 * Each provider has its own factory class for creating instances.
 */

import { Provider } from "../models";
import type { BaseProvider, ProviderOptions } from "./base";
import { DeepSeekProvider } from "./deepseekProvider";
import { GrokProvider } from "./grokProvider";
import { OpenAIProvider } from "./openaiProvider";

/** Provider settings other than the API key (Python `**kwargs`), e.g. retries and timeout. */
export type ProviderKwargs = Omit<ProviderOptions, "apiKey">;

/**
 * Abstract factory for creating provider instances.
 * Each concrete factory must implement `createProvider` and `providerName`.
 */
export abstract class ProviderFactory {
  constructor() {
    if (new.target === ProviderFactory) {
      throw new TypeError("Cannot instantiate abstract class ProviderFactory");
    }
  }

  /** Create a provider instance with the given API key and optional settings. */
  abstract createProvider(apiKey: string, kwargs?: ProviderKwargs): BaseProvider;

  /** The name of the provider this factory creates. */
  abstract get providerName(): Provider;
}

/** Factory for creating OpenAI provider instances. */
export class OpenAIFactory extends ProviderFactory {
  get providerName(): Provider {
    return Provider.OPENAI;
  }

  createProvider(apiKey: string, kwargs: ProviderKwargs = {}): BaseProvider {
    return new OpenAIProvider({ ...kwargs, apiKey });
  }
}

/** Factory for creating Grok (xAI) provider instances. */
export class GrokFactory extends ProviderFactory {
  get providerName(): Provider {
    return Provider.GROK;
  }

  createProvider(apiKey: string, kwargs: ProviderKwargs = {}): BaseProvider {
    return new GrokProvider({ ...kwargs, apiKey });
  }
}

/** Factory for creating DeepSeek provider instances. */
export class DeepSeekFactory extends ProviderFactory {
  get providerName(): Provider {
    return Provider.DEEPSEEK;
  }

  createProvider(apiKey: string, kwargs: ProviderKwargs = {}): BaseProvider {
    return new DeepSeekProvider({ ...kwargs, apiKey });
  }
}

/** Factory registry: maps provider names to factory instances. */
export const FACTORY_REGISTRY = new Map<string, ProviderFactory>([
  [Provider.OPENAI, new OpenAIFactory()],
  [Provider.GROK, new GrokFactory()],
  [Provider.DEEPSEEK, new DeepSeekFactory()],
]);

const PROVIDER_VALUES: readonly string[] = Object.values(Provider);

/**
 * Get a factory by provider name (case-insensitive).
 * Like Python, the name must be a `Provider` value, otherwise an error is thrown.
 */
export function getFactory(providerName: string): ProviderFactory {
  const name = providerName.toLowerCase();
  if (!PROVIDER_VALUES.includes(name)) {
    throw new Error(
      `Unknown provider: '${providerName}'. Available providers: ${PROVIDER_VALUES.join(", ")}`,
    );
  }

  const factory = FACTORY_REGISTRY.get(name);
  if (!factory) {
    throw new Error(`No factory registered for provider: '${name}'`);
  }
  return factory;
}

/**
 * Register a factory in the registry under the given name.
 * An existing entry with the same name is replaced.
 */
export function registerFactory(name: string, factory: ProviderFactory): void {
  FACTORY_REGISTRY.set(name, factory);
}
