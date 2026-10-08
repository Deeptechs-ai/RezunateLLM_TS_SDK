/** DeepSeek Provider — uses DeepSeek's OpenAI-compatible API. */

import { Provider } from "../models";
import { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_ENDPOINT } from "./endpoints";
import { OpenAICompatibleProvider } from "./openaiCompatible";

/** DeepSeek provider. */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  get baseUrl(): string {
    return DEEPSEEK_BASE_URL;
  }

  get providerName(): Provider {
    return Provider.DEEPSEEK;
  }

  override get chatEndpoint(): string {
    return DEEPSEEK_CHAT_ENDPOINT;
  }
}
