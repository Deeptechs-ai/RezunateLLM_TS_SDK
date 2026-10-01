/**
 * Anthropic Provider.
 * Transforms requests and responses between the OpenAI format and Anthropic's format.
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
import {
  type AnthropicMessage,
  type AnthropicRequest,
  AnthropicRequestSchema,
  AnthropicResponseSchema,
} from "./anthropicModels";
import { BaseProvider } from "./base";
import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_DEFAULT_VERSION,
  ANTHROPIC_MESSAGES_ENDPOINT,
} from "./endpoints";

/** Anthropic provider: handles transformation between OpenAI and Anthropic formats. */
export class AnthropicProvider extends BaseProvider {
  protected override readonly responseModel = AnthropicResponseSchema;

  get baseUrl(): string {
    return ANTHROPIC_BASE_URL;
  }

  get providerName(): Provider {
    return Provider.ANTHROPIC;
  }

  /** Adds `anthropic-workspace-id` when a workspace is set (needed for organization-level keys). */
  getHeaders(): Record<string, string> {
    return {
      [constants.API_KEY_HEADER]: this.apiKey,
      [constants.CONTENT_TYPE_HEADER]: constants.APPLICATION_JSON,
      [constants.ANTHROPIC_VERSION_HEADER]: ANTHROPIC_DEFAULT_VERSION,
      ...(this.workspaceId ? { [constants.ANTHROPIC_WORKSPACE_HEADER]: this.workspaceId } : {}),
    };
  }

  getEndpoint(): string {
    return ANTHROPIC_MESSAGES_ENDPOINT;
  }

  /**
   * Transform an OpenAI format request to Anthropic format.
   * The system message moves to a separate `system` field, and `max_tokens` defaults to 1024.
   */
  transformRequest(request: ChatCompletionRequest): AnthropicRequest {
    let systemContent: string | null = null;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === Role.SYSTEM) {
        if (msg.content) {
          systemContent = msg.content;
        }
        continue;
      }

      const anthropicRole = msg.role === Role.ASSISTANT ? "assistant" : "user";
      anthropicMessages.push({ role: anthropicRole, content: msg.content ?? "" });
    }

    return AnthropicRequestSchema.parse({
      model: request.model,
      max_tokens: request.max_tokens || 1024,
      messages: anthropicMessages,
      system: systemContent,
      temperature: request.temperature,
      top_k: request.top_k,
      metadata: request.metadata,
    });
  }

  /**
   * Transform an Anthropic format response to OpenAI format.
   * Text blocks are joined into `message.content`.
   */
  transformResponse(response: unknown, model?: string | null): ChatCompletionResponse {
    const anthropicResponse = AnthropicResponseSchema.parse(response);

    const textParts: string[] = [];
    for (const block of anthropicResponse.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      }
    }

    const stopReason = anthropicResponse.stop_reason;
    const finishReason = (stopReason && FINISH_REASON_MAP[stopReason]) || FinishReason.STOP;
    const content = textParts.length > 0 ? textParts.join("") : null;

    const inputTokens = anthropicResponse.usage.input_tokens;
    const outputTokens = anthropicResponse.usage.output_tokens;

    return {
      id: anthropicResponse.id || `chatcmpl-${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: anthropicResponse.model || model || null,
      choices: [
        {
          index: 0,
          message: { role: Role.ASSISTANT, content },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      provider: this.providerName,
      error: null,
    };
  }
}
