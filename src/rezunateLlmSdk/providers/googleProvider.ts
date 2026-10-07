/**
 * Google (Gemini) Provider.
 * Transforms requests and responses between the OpenAI format and Gemini's format.
 */

import { randomUUID } from "node:crypto";
import * as constants from "../constants";
import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type Choice,
  type ChoiceDelta,
  FinishReason,
  type Message,
  mapFinishReason,
  Provider,
  Role,
  type Tool,
  type ToolCall,
} from "../models";
import { BaseProvider, type StreamRequest, type StreamState } from "./base";
import {
  GOOGLE_BASE_URL,
  GOOGLE_GENERATE_CONTENT_ENDPOINT,
  GOOGLE_STREAM_GENERATE_CONTENT_ENDPOINT,
  getUrl,
} from "./endpoints";
import {
  type GoogleContentBlock,
  type GoogleMessage,
  type GoogleRequest,
  GoogleRequestSchema,
  GoogleResponseSchema,
  GoogleStreamChunkSchema,
  type GoogleTool,
  type GoogleToolConfig,
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
    return withModel(GOOGLE_GENERATE_CONTENT_ENDPOINT, model);
  }

  /**
   * Transform an OpenAI format request to Gemini format.
   * Messages become `contents` with `parts`, `assistant` becomes `model`, the system message
   * moves to `systemInstruction`, and settings go into `generationConfig`.
   * Tool calls become `functionCall` parts, and `tool` messages become `functionResponse` parts.
   */
  transformRequest(request: ChatCompletionRequest): GoogleRequest {
    let systemContent: string | null = null;
    const googleMessages: GoogleMessage[] = [];
    // The message collecting tool results, while tool messages follow each other.
    let toolResults: GoogleMessage | null = null;

    // Gemini matches a tool result by function name, so remember each tool call's name by id.
    const toolNamesById = new Map<string, string>();
    for (const msg of request.messages) {
      for (const call of msg.tool_calls ?? []) {
        toolNamesById.set(call.id, call.function.name);
      }
    }

    for (const msg of request.messages) {
      if (msg.role === Role.SYSTEM) {
        if (msg.content) {
          systemContent = msg.content;
        }
        continue;
      }

      if (msg.role === Role.TOOL) {
        let responsePayload: unknown;
        try {
          responsePayload = msg.content ? JSON.parse(msg.content) : {};
        } catch {
          responsePayload = { result: msg.content };
        }
        if (
          responsePayload === null ||
          typeof responsePayload !== "object" ||
          Array.isArray(responsePayload)
        ) {
          responsePayload = { result: responsePayload };
        }
        const part: GoogleContentBlock = {
          functionResponse: {
            // Without a name, use the name of the tool call it answers (Python uses the id).
            name:
              msg.name ||
              (msg.tool_call_id && toolNamesById.get(msg.tool_call_id)) ||
              msg.tool_call_id ||
              "tool",
            response: responsePayload as Record<string, unknown>,
          },
        };
        // Gemini wants all results of one turn's (parallel) calls in a single message.
        if (toolResults) {
          toolResults.parts.push(part);
        } else {
          toolResults = { role: "user", parts: [part] };
          googleMessages.push(toolResults);
        }
        continue;
      }

      toolResults = null;
      const googleRole = msg.role === Role.ASSISTANT ? "model" : "user";
      googleMessages.push({ role: googleRole, parts: messageToGoogleParts(msg) });
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
      tools: translateTools(request.tools),
      toolConfig: translateToolChoice(request.tool_choice),
    });
  }

  /**
   * Transform a Gemini format response to OpenAI format.
   * Each candidate becomes a choice, with its text parts joined into `message.content`
   * and its `functionCall` parts in `message.tool_calls`.
   */
  transformResponse(response: unknown, model?: string | null): ChatCompletionResponse {
    const googleResponse = GoogleResponseSchema.parse(response);

    let choices: Choice[] = googleResponse.candidates.map((candidate, idx) => {
      const textParts: string[] = [];
      const toolCalls: ToolCall[] = [];
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          textParts.push(part.text);
        }
        if (part.functionCall) {
          toolCalls.push({
            // Gemini sends no call id, so one is made up (as in Python).
            id: `call_${randomUUID().replaceAll("-", "").slice(0, 8)}`,
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            },
          });
        }
      }

      return {
        index: idx,
        message: {
          role: Role.ASSISTANT,
          content: textParts.length > 0 ? textParts.join("") : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        // Gemini still says "STOP" for a tool call; the original is kept.
        finish_reason:
          toolCalls.length > 0 ? FinishReason.TOOL_CALLS : mapFinishReason(candidate.finishReason),
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

  // ---- streaming hooks (driven by BaseProvider.stream) ----

  protected override buildStreamRequest(request: ChatCompletionRequest): StreamRequest {
    const url = getUrl(
      this.baseUrl,
      withModel(GOOGLE_STREAM_GENERATE_CONTENT_ENDPOINT, request.model),
    );
    return { url, body: this.transformRequest(request), headers: this.getHeaders() };
  }

  /**
   * Each frame is a small Gemini response; only the first candidate is streamed.
   * A blocked prompt (no candidates, a blockReason) becomes one content_filter chunk.
   */
  protected override translateFrame(
    _event: string,
    data: string,
    state: StreamState,
  ): ChatCompletionChunk | null {
    const payload = BaseProvider.parseJsonFrame(data);
    if (payload === null) {
      return null;
    }
    const frame = GoogleStreamChunkSchema.parse(payload);

    const candidate = frame.candidates[0];
    const blockReason = frame.promptFeedback?.blockReason ?? null;
    if (!candidate && !blockReason) {
      return null;
    }

    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");

    const usageMeta = frame.usageMetadata;
    const usage = usageMeta && {
      prompt_tokens: usageMeta.promptTokenCount,
      completion_tokens: usageMeta.candidatesTokenCount,
      total_tokens:
        usageMeta.totalTokenCount || usageMeta.promptTokenCount + usageMeta.candidatesTokenCount,
    };

    const delta: Partial<ChoiceDelta> = {};
    if (!state.roleSent) {
      delta.role = Role.ASSISTANT;
      state.roleSent = true;
    }
    if (text) {
      delta.content = text;
    }

    const chunk = this.makeChunk(state, {
      delta,
      finishReason: candidate ? candidate.finishReason : blockReason,
      usage,
    });
    const choice = chunk.choices[0];
    if (!candidate && choice) {
      choice.finish_reason = FinishReason.CONTENT_FILTER;
    }
    return chunk;
  }
}

/** Put the model into an endpoint, encoded so "?" or "/" in a name can't change the path. */
function withModel(endpoint: string, model?: string | null): string {
  return endpoint.replaceAll("{model}", encodeURIComponent(model ?? ""));
}

/** Render an assistant/user message as Gemini parts: its text, then any tool calls. */
function messageToGoogleParts(msg: Message): GoogleContentBlock[] {
  const parts: GoogleContentBlock[] = [];
  if (msg.content) {
    parts.push({ text: msg.content });
  }
  for (const call of msg.tool_calls ?? []) {
    let args: unknown;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      args = { _raw: call.function.arguments };
    }
    parts.push({
      functionCall: { name: call.function.name, args: args as Record<string, unknown> },
    });
  }
  if (parts.length === 0) {
    parts.push({ text: "" });
  }
  return parts;
}

/** Translate OpenAI-shaped tools into Gemini's `functionDeclarations`. */
function translateTools(tools: Tool[] | null | undefined): GoogleTool[] | null {
  if (!tools || tools.length === 0) {
    return null;
  }
  const declarations = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || "",
    // Python sends `parameters`, which Gemini rejects for keywords like additionalProperties.
    parametersJsonSchema:
      Object.keys(tool.function.parameters).length > 0
        ? tool.function.parameters
        : { type: "object", properties: {} },
  }));
  return [{ functionDeclarations: declarations }];
}

/** Translate OpenAI-shaped `tool_choice` into Gemini's `toolConfig`. */
function translateToolChoice(
  toolChoice: ChatCompletionRequest["tool_choice"],
): GoogleToolConfig | null {
  if (toolChoice == null) {
    return null;
  }
  if (typeof toolChoice === "string") {
    const mode = ({ auto: "AUTO", none: "NONE", required: "ANY" } as const)[toolChoice];
    return { functionCallingConfig: { mode } };
  }
  return {
    functionCallingConfig: { mode: "ANY", allowedFunctionNames: [toolChoice.function.name] },
  };
}
