/**
 * Qwen (Alibaba) Provider — native DashScope API.
 * Transforms requests and responses between the OpenAI format and DashScope's native format.
 */

import { randomUUID } from "node:crypto";
import * as constants from "../constants";
import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type Choice,
  type ChoiceDelta,
  mapFinishReason,
  Provider,
  Role,
} from "../models";
import { BaseProvider, type ProviderOptions, type StreamRequest, type StreamState } from "./base";
import {
  getUrl,
  QWEN_BASE_URL,
  QWEN_GENERATION_ENDPOINT,
  QWEN_WORKSPACE_BASE_URL,
} from "./endpoints";
import {
  type QwenRequest,
  QwenRequestSchema,
  QwenResponseSchema,
  QwenStreamChunkSchema,
} from "./qwenModels";

/** A workspace ID becomes part of a hostname, so only letters, numbers and "-" are allowed. */
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/** DashScope only streams when this header is set to "enable". */
const DASHSCOPE_SSE_HEADER = "X-DashScope-SSE";

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

  // ---- streaming hooks (driven by BaseProvider.stream) ----

  protected override buildStreamRequest(request: ChatCompletionRequest): StreamRequest {
    const qwenRequest = this.transformRequest(request);
    // Ensure incremental_output is enabled so each frame is a delta.
    const body = {
      ...qwenRequest,
      parameters: { ...qwenRequest.parameters, incremental_output: true },
    };
    const headers = { ...this.getHeaders(), [DASHSCOPE_SSE_HEADER]: "enable" };
    return { url: getUrl(this.baseUrl, this.getEndpoint()), body, headers };
  }

  protected override translateFrame(
    _event: string,
    data: string,
    state: StreamState,
  ): ChatCompletionChunk | null {
    const payload = BaseProvider.parseJsonFrame(data);
    if (payload === null) {
      return null;
    }
    const frame = QwenStreamChunkSchema.parse(payload);

    const output = frame.output;
    let text = "";
    let finishReasonRaw: string | null = null;
    const first = output.choices[0];
    if (first) {
      text = first.message.content || "";
      finishReasonRaw = first.finish_reason;
    } else if (output.text !== null) {
      text = output.text || "";
      finishReasonRaw = output.finish_reason;
    }

    // DashScope sends "null"/"" finish_reason while streaming; only the final frame has a value.
    const finishReason = finishReasonRaw && finishReasonRaw !== "null" ? finishReasonRaw : null;

    const usagePayload = frame.usage;
    const usage = usagePayload && {
      prompt_tokens: usagePayload.input_tokens,
      completion_tokens: usagePayload.output_tokens,
      total_tokens:
        usagePayload.total_tokens || usagePayload.input_tokens + usagePayload.output_tokens,
    };

    const delta: Partial<ChoiceDelta> = {};
    if (!state.roleSent) {
      delta.role = Role.ASSISTANT;
      state.roleSent = true;
    }
    if (text) {
      delta.content = text;
    }

    // Skip frames that carry neither content nor a terminal signal. (As in Python, roleSent is
    // already true here, so an empty first frame is skipped too and its role is not sent.)
    if (!text && finishReason === null && usage === null && state.roleSent) {
      return null;
    }

    // Prefer the per-frame request_id over the state's uuid placeholder.
    if (frame.request_id) {
      state.id = frame.request_id;
    }

    return this.makeChunk(state, { delta, finishReason, usage });
  }
}
