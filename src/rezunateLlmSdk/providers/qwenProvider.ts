/**
 * Qwen (Alibaba) Provider — native DashScope API.
 * Transforms requests and responses between the OpenAI format and DashScope's native format.
 */

import * as constants from "../constants";
import {
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type Choice,
  mapFinishReason,
  Provider,
  Role,
} from "../models";
import { BaseProvider, type ProviderOptions } from "./base";
import { QWEN_BASE_URL, QWEN_GENERATION_ENDPOINT, QWEN_WORKSPACE_BASE_URL } from "./endpoints";
import { type QwenRequest, QwenRequestSchema, QwenResponseSchema } from "./qwenModels";

/** A workspace ID becomes part of a hostname, so only letters, numbers and "-" are allowed. */
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/** Qwen provider against Alibaba DashScope's native generation API. */
export class QwenProvider extends BaseProvider {
  protected override readonly responseModel = QwenResponseSchema;

  /** Throws for a workspace ID that could point the request (and the API key) at another host. */
  constructor(options: ProviderOptions) {
    super(options);
    if (this.workspaceId !== null && !WORKSPACE_ID_PATTERN.test(this.workspaceId)) {
      throw new Error(
        `Invalid Qwen workspaceId: '${this.workspaceId}'. Only letters, numbers and "-" are allowed.`,
      );
    }
  }

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

    return this.buildResponse({
      id: qwenResponse.request_id,
      model,
      choices,
      promptTokens: qwenResponse.usage.input_tokens,
      completionTokens: qwenResponse.usage.output_tokens,
      totalTokens: qwenResponse.usage.total_tokens,
    });
  }
}
