/**
 * Anthropic Provider.
 * Transforms requests and responses between the OpenAI format and Anthropic's format.
 */

import { randomUUID } from "node:crypto";
import * as constants from "../constants";
import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type Message,
  mapFinishReason,
  Provider,
  Role,
  type Tool,
  type ToolCall,
} from "../models";
import {
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicRequest,
  AnthropicRequestSchema,
  AnthropicResponseSchema,
  AnthropicStreamEventSchema,
  type AnthropicTool,
  type AnthropicToolChoice,
} from "./anthropicModels";
import { BaseProvider, type StreamRequest, type StreamState } from "./base";
import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_DEFAULT_VERSION,
  ANTHROPIC_MESSAGES_ENDPOINT,
  getUrl,
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
   * Tool calls become `tool_use` blocks, and `tool` messages become `tool_result` blocks.
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

      if (msg.role === Role.TOOL) {
        anthropicMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id ?? "",
              content: msg.content ?? "",
            },
          ],
        });
        continue;
      }

      const anthropicRole = msg.role === Role.ASSISTANT ? "assistant" : "user";
      const blocks = messageToAnthropicBlocks(msg);
      anthropicMessages.push({ role: anthropicRole, content: blocks ?? msg.content ?? "" });
    }

    return AnthropicRequestSchema.parse({
      model: request.model,
      max_tokens: request.max_tokens || 1024,
      messages: anthropicMessages,
      system: systemContent,
      temperature: request.temperature,
      top_k: request.top_k,
      metadata: request.metadata,
      tools: translateTools(request.tools),
      tool_choice: translateToolChoice(request.tool_choice),
    });
  }

  /**
   * Transform an Anthropic format response to OpenAI format.
   * Text blocks are joined into `message.content`, and `tool_use` blocks become `tool_calls`.
   */
  transformResponse(response: unknown, model?: string | null): ChatCompletionResponse {
    const anthropicResponse = AnthropicResponseSchema.parse(response);

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of anthropicResponse.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      }
    }

    const stopReason = anthropicResponse.stop_reason;
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
          message: {
            role: Role.ASSISTANT,
            content,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: mapFinishReason(stopReason),
          provider_finish_reason: stopReason,
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

  // ---- streaming hooks (driven by BaseProvider.stream) ----

  protected override buildStreamRequest(request: ChatCompletionRequest): StreamRequest {
    const body = { ...this.transformRequest(request), stream: true };
    return { url: getUrl(this.baseUrl, this.getEndpoint()), body, headers: this.getHeaders() };
  }

  protected override isStreamTerminator(event: string): boolean {
    return event === "message_stop";
  }

  protected override translateFrame(
    event: string,
    data: string,
    state: StreamState,
  ): ChatCompletionChunk | null {
    if (event === "ping" || event === "content_block_start" || event === "content_block_stop") {
      return null;
    }

    const parsed = AnthropicStreamEventSchema.safeParse(BaseProvider.parseJsonFrame(data) ?? {});
    if (!parsed.success) {
      throw new Error(`Invalid Anthropic "${event}" event: ${parsed.error.message}`);
    }
    const payload = parsed.data;

    if (event === "message_start") {
      state.id = payload.message?.id || state.id;
      state.model = payload.message?.model || state.model;
      state.inputTokens = payload.message?.usage?.input_tokens ?? 0;
      return this.makeChunk(state, { delta: { role: Role.ASSISTANT, content: "" } });
    }

    if (event === "content_block_delta") {
      const text = payload.delta?.text;
      if (payload.delta?.type === "text_delta" && text) {
        return this.makeChunk(state, { delta: { content: text } });
      }
      return null;
    }

    if (event === "message_delta") {
      const outputTokens = payload.usage?.output_tokens ?? 0;
      return this.makeChunk(state, {
        finishReason: payload.delta?.stop_reason ?? null,
        usage: {
          prompt_tokens: state.inputTokens,
          completion_tokens: outputTokens,
          total_tokens: state.inputTokens + outputTokens,
        },
      });
    }

    if (event === "error") {
      const message = payload.error?.message || "anthropic stream error";
      return this.errorChunk(new Error(message), state.model);
    }

    return null;
  }
}

/**
 * Build Anthropic content blocks from an assistant message with tool calls.
 * Returns `null` when there are no tool calls (the caller then sends plain text).
 */
function messageToAnthropicBlocks(msg: Message): AnthropicContentBlock[] | null {
  if (!msg.tool_calls || msg.tool_calls.length === 0) {
    return null;
  }

  const blocks: AnthropicContentBlock[] = [];
  if (msg.content) {
    blocks.push({ type: "text", text: msg.content });
  }
  for (const call of msg.tool_calls) {
    let input: unknown;
    try {
      input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      input = { _raw: call.function.arguments };
    }
    blocks.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: input as Record<string, unknown>,
    });
  }
  return blocks;
}

/** Translate OpenAI-shaped tools into Anthropic's tool schema. */
function translateTools(tools: Tool[] | null | undefined): AnthropicTool[] | null {
  if (!tools || tools.length === 0) {
    return null;
  }
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || "",
    input_schema:
      Object.keys(tool.function.parameters).length > 0
        ? tool.function.parameters
        : { type: "object", properties: {} },
  }));
}

/** Translate OpenAI-shaped `tool_choice` into Anthropic's format. */
function translateToolChoice(
  toolChoice: ChatCompletionRequest["tool_choice"],
): AnthropicToolChoice | null {
  // Same as Python: "none" is not sent, so Anthropic's default ("auto") applies.
  if (toolChoice == null || toolChoice === "none") {
    return null;
  }
  if (toolChoice === "auto") {
    return { type: "auto" };
  }
  if (toolChoice === "required") {
    return { type: "any" };
  }
  return { type: "tool", name: toolChoice.function.name };
}
