/**
 * Request and response models, following the OpenAI format as the universal standard.
 *
 * Each model is a zod schema (runtime validation, like pydantic) plus a TypeScript type
 * generated from it with `z.infer`. Field names stay snake_case because they are the JSON
 * sent to and received from the providers.
 */

import { z } from "zod";

// ---- Enums ----------------------------------------------------------------------------

/** Available LLM providers. */
export const Provider = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  GROK: "grok",
  META: "meta",
  DEEPSEEK: "deepseek",
  QWEN: "qwen",
} as const;
export type Provider = (typeof Provider)[keyof typeof Provider];
export const ProviderSchema = z.enum(Provider);

/** Message roles. */
export const Role = {
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const RoleSchema = z.enum(Role);

/** Reason why a completion finished. */
export const FinishReason = {
  STOP: "stop",
  LENGTH: "length",
  CONTENT_FILTER: "content_filter",
  TOOL_CALLS: "tool_calls",
} as const;
export type FinishReason = (typeof FinishReason)[keyof typeof FinishReason];
export const FinishReasonSchema = z.enum(FinishReason);

/** Centralized mapping for all provider-specific finish reasons. */
export const FINISH_REASON_MAP: Readonly<Record<string, FinishReason>> = {
  // OpenAI-style values — also emitted by xAI (Grok), DeepSeek,
  // Meta (Muse Spark), and Qwen native (DashScope, result_format="message").
  stop: FinishReason.STOP,
  length: FinishReason.LENGTH,
  content_filter: FinishReason.CONTENT_FILTER,
  tool_calls: FinishReason.TOOL_CALLS,
  // OpenAI's old name for tool_calls; OpenAI-compatible APIs (e.g. Meta) may still send it
  function_call: FinishReason.TOOL_CALLS,
  // DeepSeek-specific — returned by deepseek-reasoner under resource pressure
  insufficient_system_resource: FinishReason.STOP,
  aborted: FinishReason.STOP,
  // Google Gemini (image-only reasons are left out: the SDK is text-only, so they become stop)
  STOP: FinishReason.STOP,
  MAX_TOKENS: FinishReason.LENGTH,
  SAFETY: FinishReason.CONTENT_FILTER,
  RECITATION: FinishReason.CONTENT_FILTER,
  BLOCKLIST: FinishReason.CONTENT_FILTER,
  PROHIBITED_CONTENT: FinishReason.CONTENT_FILTER,
  SPII: FinishReason.CONTENT_FILTER,
  OTHER: FinishReason.STOP,
  MALFORMED_FUNCTION_CALL: FinishReason.STOP,
  UNEXPECTED_TOOL_CALL: FinishReason.STOP,
  TOO_MANY_TOOL_CALLS: FinishReason.STOP,
  CONTINUATION: FinishReason.LENGTH,
  LANGUAGE: FinishReason.STOP,
  FINISH_REASON_UNSPECIFIED: FinishReason.STOP,
  // Anthropic
  end_turn: FinishReason.STOP,
  stop_sequence: FinishReason.STOP,
  max_tokens: FinishReason.LENGTH,
  tool_use: FinishReason.TOOL_CALLS,
  refusal: FinishReason.CONTENT_FILTER,
  model_context_window_exceeded: FinishReason.LENGTH,
  pause_turn: FinishReason.STOP,
};

/**
 * Translate a provider's finish/stop reason into ours.
 * Unknown or missing reasons fall back to `stop`, so a new provider value never breaks a reply.
 */
export function mapFinishReason(reason: string | null | undefined): FinishReason {
  // Object.hasOwn ignores built-in object names such as "constructor" or "__proto__".
  return reason && Object.hasOwn(FINISH_REASON_MAP, reason)
    ? (FINISH_REASON_MAP[reason] ?? FinishReason.STOP)
    : FinishReason.STOP;
}

// ---- Tools ----------------------------------------------------------------------------

/** OpenAI-shaped function-call payload inside a tool call. */
export const FunctionCallSchema = z.object({
  name: z.string(),
  /** The arguments as a JSON string, e.g. `{"city":"Paris"}`. */
  arguments: z.string().default(""),
});
export type FunctionCall = z.infer<typeof FunctionCallSchema>;

/** A tool/function call requested by the assistant (OpenAI's `message.tool_calls[*]`). */
export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function").default("function"),
  function: FunctionCallSchema,
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** OpenAI-shaped tool function definition (sent on the request side). */
export const FunctionDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  /** Caller-supplied JSON Schema for the function's arguments. */
  parameters: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type FunctionDefinition = z.infer<typeof FunctionDefinitionSchema>;

/** OpenAI-shaped tool entry passed in `ChatCompletionRequest.tools`. */
export const ToolSchema = z.object({
  type: z.literal("function").default("function"),
  function: FunctionDefinitionSchema,
});
export type Tool = z.infer<typeof ToolSchema>;

/** Inner `function` block of a `tool_choice` selecting a specific tool. */
export const ToolChoiceFunctionSchema = z.object({
  name: z.string(),
});
export type ToolChoiceFunction = z.infer<typeof ToolChoiceFunctionSchema>;

/** Structured `tool_choice` payload selecting a specific function. */
export const ToolChoiceOptionSchema = z.object({
  type: z.literal("function").default("function"),
  function: ToolChoiceFunctionSchema,
});
export type ToolChoiceOption = z.infer<typeof ToolChoiceOptionSchema>;

// ---- Request --------------------------------------------------------------------------

/** A chat message. Unknown extra fields are kept, as with pydantic's `extra="allow"`. */
export const MessageSchema = z.looseObject({
  role: RoleSchema,
  content: z.string().nullish(),
  name: z.string().nullish(),
  tool_call_id: z.string().nullish(),
  tool_calls: z.array(ToolCallSchema).nullish(),
});
export type Message = z.infer<typeof MessageSchema>;

/** Request model for chat completion. Unknown extra fields are kept. */
export const ChatCompletionRequestSchema = z.looseObject({
  model: z.string(),
  messages: z.array(MessageSchema),
  temperature: z.number().nullish(),
  max_tokens: z.number().int().nullish(),
  top_p: z.number().nullish(),
  frequency_penalty: z.number().nullish(),
  presence_penalty: z.number().nullish(),
  stop: z.union([z.string(), z.array(z.string())]).nullish(),
  n: z.number().int().nullish(),
  stream: z.boolean().nullish(),
  user: z.string().nullish(),
  tools: z.array(ToolSchema).nullish(),
  tool_choice: z.union([z.enum(["auto", "required", "none"]), ToolChoiceOptionSchema]).nullish(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// ---- Response -------------------------------------------------------------------------

/** Token usage information. */
export const UsageSchema = z.object({
  prompt_tokens: z.number().int().default(0),
  completion_tokens: z.number().int().default(0),
  total_tokens: z.number().int().default(0),
});
export type Usage = z.infer<typeof UsageSchema>;

/** Message in a chat completion response. */
export const ResponseMessageSchema = z.object({
  role: RoleSchema.default(Role.ASSISTANT),
  content: z.string().nullable().default(null),
  /** Present only when the model asks for tool calls. */
  tool_calls: z.array(ToolCallSchema).nullish(),
});
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;

/** A completion choice. */
export const ChoiceSchema = z.object({
  index: z.number().int().default(0),
  message: ResponseMessageSchema,
  finish_reason: FinishReasonSchema.nullable().default(null),
  /** The provider's original finish/stop reason (e.g. "refusal", "SAFETY"), if any. */
  provider_finish_reason: z.string().nullable().default(null),
});
export type Choice = z.infer<typeof ChoiceSchema>;

/** Error information for failed requests. */
export const ErrorInfoSchema = z.object({
  message: z.string(),
  type: z.string().default("api_error"),
  code: z.number().int().nullable().default(null),
  retries_attempted: z.number().int().nullable().default(null),
});
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

/** Response model for chat completion in OpenAI format. */
export const ChatCompletionResponseSchema = z.object({
  id: z.string().nullable().default(null),
  object: z.string().default("chat.completion"),
  created: z.number().int().default(0),
  model: z.string().nullable().default(null),
  choices: z.array(ChoiceSchema).default(() => []),
  usage: UsageSchema.default(() => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })),
  provider: ProviderSchema.nullable().default(null),
  error: ErrorInfoSchema.nullable().default(null),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

/**
 * One piece of a streamed tool call (OpenAI's `delta.tool_calls[*]`).
 * The first piece of a call has `id`, `type` and `function.name`; later pieces add to
 * `function.arguments`. Pieces of the same call share `index`.
 */
export const ToolCallDeltaSchema = z.object({
  // Default 0, so a provider that leaves it out can't break the stream.
  index: z.number().int().default(0),
  id: z.string().nullish(),
  type: z.literal("function").nullish(),
  function: z
    .object({
      name: z.string().nullish(),
      arguments: z.string().nullish(),
    })
    .nullish(),
});
export type ToolCallDelta = z.infer<typeof ToolCallDeltaSchema>;

/** Incremental delta for a streaming choice (OpenAI chunk shape). */
export const ChoiceDeltaSchema = z.object({
  role: RoleSchema.nullable().default(null),
  content: z.string().nullable().default(null),
  /** Present only in chunks that carry tool-call pieces. */
  tool_calls: z.array(ToolCallDeltaSchema).nullish(),
});
export type ChoiceDelta = z.infer<typeof ChoiceDeltaSchema>;

/** A single choice in a streaming chat completion chunk. */
export const ChoiceChunkSchema = z.object({
  index: z.number().int().default(0),
  delta: ChoiceDeltaSchema.default(() => ({ role: null, content: null })),
  finish_reason: FinishReasonSchema.nullable().default(null),
  /** The provider's original finish/stop reason, if any (same as in `Choice`). */
  provider_finish_reason: z.string().nullable().default(null),
});
export type ChoiceChunk = z.infer<typeof ChoiceChunkSchema>;

/** One chunk of a streaming chat completion in OpenAI format. */
export const ChatCompletionChunkSchema = z.object({
  id: z.string().nullable().default(null),
  object: z.string().default("chat.completion.chunk"),
  created: z.number().int().default(0),
  model: z.string().nullable().default(null),
  choices: z.array(ChoiceChunkSchema).default(() => []),
  usage: UsageSchema.nullable().default(null),
  provider: ProviderSchema.nullable().default(null),
  error: ErrorInfoSchema.nullable().default(null),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;

// ---- Rezunate LLM API -----------------------------------------------------------------

/** A prompt returned by the Rezunate LLM API. Dates are parsed into `Date` objects. */
export const PromptResponseSchema = z.object({
  slug_id: z.string(),
  name: z.string(),
  content: z.string(),
  description: z.string().nullable().default(null),
  current_version: z.number().int(),
  workspace_id: z.number().int(),
  /** The server allows null here (e.g. when the creator was deleted). */
  created_by: z.number().int().nullable(),
  input_variables: z.array(z.string()).nullable().default(null),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});
export type PromptResponse = z.infer<typeof PromptResponseSchema>;
