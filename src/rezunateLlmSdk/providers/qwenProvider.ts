/**
 * Qwen (Alibaba) Provider — native DashScope API.
 * Transforms requests and responses between the OpenAI format and DashScope's native format.
 */

import { randomUUID } from "node:crypto";
import * as constants from "../constants";
import {
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type Choice,
  mapFinishReason,
  Provider,
  Role,
} from "../models";
import { BaseProvider } from "./base";
import { QWEN_BASE_URL, QWEN_GENERATION_ENDPOINT, QWEN_WORKSPACE_BASE_URL } from "./endpoints";
import { type QwenRequest, QwenRequestSchema, QwenResponseSchema } from "./qwenModels";

/** Qwen provider against Alibaba DashScope's native generation API. */
export class QwenProvider extends BaseProvider {
  protected override readonly responseModel = QwenResponseSchema;

  /** The workspace-specific domain when a workspace is set, otherwise the default domain. */
  get baseUrl(): string {
    return this.workspaceId
      ? QWEN_WORKSPACE_BASE_URL.replace("{workspaceId}", this.workspaceId)
      : QWEN_BASE_URL;
  }

  get providerName(): Provider {
    return Provider.QWEN;
  }

  getHeaders(): Record<string, string> {
    return {
      [constants.AUTHORIZATION_HEADER]: `Bearer ${this.apiKey}`,
      [constants.CONTENT_TYPE_HEADER]: constants.APPLICATION_JSON,
    };
  }

  getEndpoint(): string {
    return QWEN_GENERATION_ENDPOINT;
  }

  /**
   * Transform an OpenAI format request to DashScope native format.
   * Messages move under `input.messages`, and settings under `parameters`.
   */
  transformRequest(request: ChatCompletionRequest): QwenRequest {
    return QwenRequestSchema.parse({
      model: request.model,
      input: {
        messages: request.messages.map((msg) => ({ role: msg.role, content: msg.content })),
      },
      parameters: {
        result_format: "message",
        temperature: request.temperature,
        top_p: request.top_p,
        top_k: request.top_k,
        max_tokens: request.max_tokens,
        stop: request.stop,
        seed: request.seed,
        enable_search: request.enable_search,
        repetition_penalty: request.repetition_penalty,
      },
    });
  }

  /**
   * Transform a DashScope native response to OpenAI format.
   * Reads `output.choices`, or the legacy `output.text` when there are no choices.
   */
  transformResponse(response: unknown, model?: string | null): ChatCompletionResponse {
    const qwenResponse = QwenResponseSchema.parse(response);
    const output = qwenResponse.output;

    let choices: Choice[] = [];
    if (output.choices.length > 0) {
      choices = output.choices.map((choice, idx) => ({
        index: idx,
        message: { role: Role.ASSISTANT, content: choice.message.content },
        finish_reason: mapFinishReason(choice.finish_reason),
        provider_finish_reason: choice.finish_reason,
      }));
    } else if (output.text !== null) {
      // Legacy result_format="text" path
      choices = [
        {
          index: 0,
          message: { role: Role.ASSISTANT, content: output.text },
          finish_reason: mapFinishReason(output.finish_reason),
          provider_finish_reason: output.finish_reason,
        },
      ];
    }

    const inputTokens = qwenResponse.usage.input_tokens;
    const outputTokens = qwenResponse.usage.output_tokens;
    const totalTokens = qwenResponse.usage.total_tokens || inputTokens + outputTokens;

    return {
      id: qwenResponse.request_id || `chatcmpl-${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model ?? null,
      choices,
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: totalTokens,
      },
      provider: this.providerName,
      error: null,
    };
  }
}
