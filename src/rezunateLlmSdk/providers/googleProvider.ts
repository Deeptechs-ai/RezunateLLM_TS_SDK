/**
 * Google (Gemini) Provider.
 * Transforms requests and responses between the OpenAI format and Gemini's format.
 */

import { randomUUID } from "node:crypto";
import * as constants from "../constants";
import {
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type Choice,
  FinishReason,
  mapFinishReason,
  Provider,
  Role,
} from "../models";
import { BaseProvider } from "./base";
import { GOOGLE_BASE_URL, GOOGLE_GENERATE_CONTENT_ENDPOINT } from "./endpoints";
import {
  type GoogleMessage,
  type GoogleRequest,
  GoogleRequestSchema,
  GoogleResponseSchema,
} from "./googleModels";

/** Google Gemini provider: handles transformation between OpenAI and Gemini formats. */
export class GoogleProvider extends BaseProvider {
  protected override readonly responseModel = GoogleResponseSchema;

  get baseUrl(): string {
    return GOOGLE_BASE_URL;
  }

  get providerName(): Provider {
    return Provider.GOOGLE;
  }

  getHeaders(): Record<string, string> {
    return {
      [constants.CONTENT_TYPE_HEADER]: constants.APPLICATION_JSON,
      [constants.GOOGLE_API_KEY_HEADER]: this.apiKey,
    };
  }

  /** The endpoint includes the model name, e.g. `/models/gemini-2.0-flash:generateContent`. */
  getEndpoint(model?: string | null): string {
    // Encoded so characters like "?" or "/" in a model name can't change the request path.
    return GOOGLE_GENERATE_CONTENT_ENDPOINT.replaceAll("{model}", encodeURIComponent(model ?? ""));
  }

  /**
   * Transform an OpenAI format request to Gemini format.
   * Messages become `contents` with `parts`, `assistant` becomes `model`, the system message
   * moves to `systemInstruction`, and settings go into `generationConfig`.
   */
  transformRequest(request: ChatCompletionRequest): GoogleRequest {
    let systemContent: string | null = null;
    const googleMessages: GoogleMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === Role.SYSTEM) {
        if (msg.content) {
          systemContent = msg.content;
        }
        continue;
      }

      const googleRole = msg.role === Role.ASSISTANT ? "model" : "user";
      googleMessages.push({ role: googleRole, parts: [{ text: msg.content || "" }] });
    }

    const systemInstruction = systemContent ? { parts: [{ text: systemContent }] } : null;

    const topK = request.top_k;
    const generationConfig =
      request.temperature != null || request.max_tokens != null || topK != null
        ? { temperature: request.temperature, maxOutputTokens: request.max_tokens, topK }
        : null;

    return GoogleRequestSchema.parse({
      contents: googleMessages,
      systemInstruction,
      generationConfig,
      safetySettings: request.safety_settings,
    });
  }

  /**
   * Transform a Gemini format response to OpenAI format.
   * Each candidate becomes a choice, with its text parts joined into `message.content`.
   */
  transformResponse(response: unknown, model?: string | null): ChatCompletionResponse {
    const googleResponse = GoogleResponseSchema.parse(response);

    let choices: Choice[] = googleResponse.candidates.map((candidate, idx) => {
      const textParts: string[] = [];
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          textParts.push(part.text);
        }
      }

      return {
        index: idx,
        message: {
          role: Role.ASSISTANT,
          content: textParts.length > 0 ? textParts.join("") : null,
        },
        finish_reason: mapFinishReason(candidate.finishReason),
        provider_finish_reason: candidate.finishReason,
      };
    });

    // The prompt itself was blocked: no candidates, the reason is in promptFeedback.
    const blockReason = googleResponse.promptFeedback?.blockReason;
    if (choices.length === 0 && blockReason) {
      choices = [
        {
          index: 0,
          message: { role: Role.ASSISTANT, content: null },
          finish_reason: FinishReason.CONTENT_FILTER,
          provider_finish_reason: blockReason,
        },
      ];
    }

    const usageMeta = googleResponse.usageMetadata;
    const promptTokens = usageMeta.promptTokenCount;
    const completionTokens = usageMeta.candidatesTokenCount;
    const totalTokens = usageMeta.totalTokenCount || promptTokens + completionTokens;

    return {
      id: `chatcmpl-${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model ?? null,
      choices,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
      provider: this.providerName,
      error: null,
    };
  }
}
