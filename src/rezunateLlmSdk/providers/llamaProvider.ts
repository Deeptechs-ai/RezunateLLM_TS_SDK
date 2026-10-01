/**
 * Llama (Meta) Provider — native API.
 * Transforms requests and responses between the OpenAI format and Meta's native format.
 */

import { randomUUID } from "node:crypto";
import * as constants from "../constants";
import {
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  FINISH_REASON_MAP,
  FinishReason,
  Provider,
  Role,
} from "../models";
import { BaseProvider } from "./base";
import { LLAMA_BASE_URL, LLAMA_CHAT_ENDPOINT } from "./endpoints";
import { type LlamaRequest, LlamaRequestSchema, LlamaResponseSchema } from "./llamaModels";

/** Llama provider against Meta's native chat completion API. */
export class LlamaProvider extends BaseProvider {
  protected override readonly responseModel = LlamaResponseSchema;

  get baseUrl(): string {
    return LLAMA_BASE_URL;
  }

  get providerName(): Provider {
    return Provider.LLAMA;
  }

  getHeaders(): Record<string, string> {
    return {
      [constants.AUTHORIZATION_HEADER]: `Bearer ${this.apiKey}`,
      [constants.CONTENT_TYPE_HEADER]: constants.APPLICATION_JSON,
    };
  }

  getEndpoint(): string {
    return LLAMA_CHAT_ENDPOINT;
  }

  /**
   * Transform an OpenAI format request to Meta Llama native format.
   * Messages keep their roles; `max_tokens` becomes `max_completion_tokens`.
   */
  transformRequest(request: ChatCompletionRequest): LlamaRequest {
    return LlamaRequestSchema.parse({
      model: request.model,
      messages: request.messages.map((msg) => ({ role: msg.role, content: msg.content })),
      max_completion_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
      top_k: request.top_k,
      repetition_penalty: request.repetition_penalty,
      stream: request.stream,
      tools: request.tools,
      response_format: request.response_format,
    });
  }

  /**
   * Transform a Meta Llama native response to OpenAI format.
   * The single completion message becomes `choices[0]`; the `metrics` array becomes `usage`.
   */
  transformResponse(response: unknown, model?: string | null): ChatCompletionResponse {
    const llamaResponse = LlamaResponseSchema.parse(response);
    const completion = llamaResponse.completion_message;

    const finishReason = FINISH_REASON_MAP[completion.stop_reason || "stop"] ?? FinishReason.STOP;

    // Unpack the metrics array into the OpenAI usage object.
    const metricValues: Record<string, number> = {};
    for (const metric of llamaResponse.metrics) {
      metricValues[metric.metric] = Math.trunc(metric.value);
    }

    const promptTokens = metricValues[constants.LLAMA_METRIC_PROMPT_TOKENS] ?? 0;
    const completionTokens = metricValues[constants.LLAMA_METRIC_COMPLETION_TOKENS] ?? 0;
    const totalTokens =
      metricValues[constants.LLAMA_METRIC_TOTAL_TOKENS] ?? promptTokens + completionTokens;

    return {
      id: llamaResponse.id || `chatcmpl-${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model ?? null,
      choices: [
        {
          index: 0,
          message: { role: Role.ASSISTANT, content: completion.content.text },
          finish_reason: finishReason,
        },
      ],
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
