/** Meta Provider — uses the OpenAI-compatible Meta Model API (Muse Spark models). */

import { Provider } from "../models";
import { META_BASE_URL, META_CHAT_ENDPOINT } from "./endpoints";
import { OpenAICompatibleProvider } from "./openaiCompatible";

/** Meta provider. */
export class MetaProvider extends OpenAICompatibleProvider {
  get baseUrl(): string {
    return META_BASE_URL;
  }

  get providerName(): Provider {
    return Provider.META;
  }

  override get chatEndpoint(): string {
    return META_CHAT_ENDPOINT;
  }
}
