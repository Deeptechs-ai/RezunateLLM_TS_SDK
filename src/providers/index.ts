/**
 * Provider registry.
 * Creates provider instances by name, using the Factory Method Pattern.
 */

import type { BaseProvider } from "./base";
import { FACTORY_REGISTRY, getFactory, type ProviderKwargs } from "./factory";

export { AnthropicProvider } from "./anthropicProvider";
export { BaseProvider, type ProviderOptions } from "./base";
export { DeepSeekProvider } from "./deepseekProvider";
export {
  AnthropicFactory,
  DeepSeekFactory,
  FACTORY_REGISTRY,
  GrokFactory,
  getFactory,
  OpenAIFactory,
  ProviderFactory,
  type ProviderKwargs,
  registerFactory,
} from "./factory";
export { GrokProvider } from "./grokProvider";
export { OpenAIProvider } from "./openaiProvider";

/**
 * Get a provider instance by name, e.g. `getProvider("openai", apiKey)`.
 * Throws if the provider name is unknown.
 */
export function getProvider(
  providerName: string,
  apiKey: string,
  kwargs: ProviderKwargs = {},
): BaseProvider {
  const factory = getFactory(providerName);
  return factory.createProvider(apiKey, kwargs);
}

/** Return the names of all registered providers. */
export function listProviders(): string[] {
  return [...FACTORY_REGISTRY.keys()];
}
