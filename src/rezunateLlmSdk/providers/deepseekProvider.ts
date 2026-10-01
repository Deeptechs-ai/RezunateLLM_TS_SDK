/** DeepSeek Provider — uses DeepSeek's OpenAI-compatible API. */

import { type ChatCompletionResponse, FINISH_REASON_MAP, Provider } from "../models";
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

  /**
   * Normalize DeepSeek-specific finish_reason values before validation.
   * `deepseek-reasoner` can emit `insufficient_system_resource`, which is mapped to `stop`.
   */
  override transformResponse(response: unknown): ChatCompletionResponse {
    if (response === null || typeof response !== "object") {
      return super.transformResponse(response);
    }

    const data = { ...(response as Record<string, unknown>) };
    if (Array.isArray(data.choices)) {
      data.choices = data.choices.map((choice: Record<string, unknown>) => {
        const reason = choice.finish_reason;
        return typeof reason === "string" && reason in FINISH_REASON_MAP
          ? { ...choice, finish_reason: FINISH_REASON_MAP[reason] }
          : choice;
      });
    }
    return super.transformResponse(data);
  }
}
