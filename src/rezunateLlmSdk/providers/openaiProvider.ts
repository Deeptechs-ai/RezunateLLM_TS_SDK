/** OpenAI Provider — uses the official OpenAI SDK. */

import { type Provider, Provider as Providers } from "../models";
import { OPENAI_BASE_URL } from "./endpoints";
import { OpenAICompatibleProvider } from "./openaiCompatible";

/** OpenAI provider. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  get baseUrl(): string {
    return OPENAI_BASE_URL;
  }

  get providerName(): Provider {
    return Providers.OPENAI;
  }
}
