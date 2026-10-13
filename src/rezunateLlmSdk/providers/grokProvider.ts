/** Grok (xAI) Provider — uses xAI's OpenAI-compatible API. */

import { Provider } from "../models";
import { GROK_BASE_URL, GROK_CHAT_ENDPOINT } from "./endpoints";
import { OpenAICompatibleProvider } from "./openaiCompatible";

/** Grok provider. */
export class GrokProvider extends OpenAICompatibleProvider {
  get baseUrl(): string {
    return GROK_BASE_URL;
  }

  get providerName(): Provider {
    return Provider.GROK;
  }

  override get chatEndpoint(): string {
    return GROK_CHAT_ENDPOINT;
  }
}
