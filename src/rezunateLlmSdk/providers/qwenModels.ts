/**
 * Qwen (Alibaba DashScope) native API models.
 * These represent DashScope's text-generation request/response format (not the OpenAI-compatible mode).
 */

import { z } from "zod";

// ---- Tools -----------------------------------------------------------------------------

/** A tool call, in the same shape as OpenAI's (DashScope also sends an `index`). */
export const QwenToolCallSchema = z.looseObject({
  // Streamed pieces of one call share `index`; later pieces may have no id, type or name.
  index: z.number().int().nullish(),
  id: z.string().default(""),
  type: z.literal("function").nullish(),
  function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish(),
});
export type QwenToolCall = z.infer<typeof QwenToolCallSchema>;

/** A tool definition, in the same shape as OpenAI's. */
export const QwenToolSchema = z.object({
  type: z.literal("function").default("function"),
  function: z.object({
    name: z.string(),
    description: z.string().nullish(),
    parameters: z.record(z.string(), z.unknown()).nullish(),
  }),
});
export type QwenTool = z.infer<typeof QwenToolSchema>;

// ---- Request ---------------------------------------------------------------------------

/** Message in DashScope native format. */
export const QwenMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  tool_calls: z.array(QwenToolCallSchema).nullish(),
  tool_call_id: z.string().nullish(),
});
export type QwenMessage = z.infer<typeof QwenMessageSchema>;

/** Input wrapper: DashScope puts the messages under `input.messages`. */
export const QwenInputSchema = z.object({
  messages: z.array(QwenMessageSchema),
});
export type QwenInput = z.infer<typeof QwenInputSchema>;

/** Generation parameters, sent under `parameters`. Unknown extra fields are kept. */
export const QwenParametersSchema = z.looseObject({
  result_format: z.enum(["message", "text"]).default("message"),
  temperature: z.number().nullish(),
  top_p: z.number().nullish(),
  top_k: z.number().int().nullish(),
  max_tokens: z.number().int().nullish(),
  stop: z.union([z.string(), z.array(z.string())]).nullish(),
  seed: z.number().int().nullish(),
  enable_search: z.boolean().nullish(),
  repetition_penalty: z.number().nullish(),
  // Tools must go under `parameters`, and need result_format "message".
  tools: z.array(QwenToolSchema).nullish(),
  tool_choice: z
    .union([
      z.enum(["auto", "none", "required"]),
      z.object({ type: z.literal("function"), function: z.object({ name: z.string() }) }),
    ])
    .nullish(),
  parallel_tool_calls: z.boolean().nullish(),
});
export type QwenParameters = z.infer<typeof QwenParametersSchema>;

/** DashScope native generation request. Unknown extra fields are kept. */
export const QwenRequestSchema = z.looseObject({
  model: z.string(),
  input: QwenInputSchema,
  parameters: QwenParametersSchema.nullish(),
});
export type QwenRequest = z.infer<typeof QwenRequestSchema>;

// ---- Response --------------------------------------------------------------------------

/** Message inside a DashScope response choice. */
export const QwenResponseMessageSchema = z.object({
  role: z.literal("assistant").default("assistant"),
  // May be null or empty when the model only asks for tool calls.
  content: z.string().nullable().default(""),
  tool_calls: z.array(QwenToolCallSchema).nullish(),
});
export type QwenResponseMessage = z.infer<typeof QwenResponseMessageSchema>;

/** A single choice in the DashScope response output. */
export const QwenChoiceSchema = z.object({
  finish_reason: z.string().nullable().default(null),
  message: QwenResponseMessageSchema.default(() => ({ role: "assistant" as const, content: "" })),
});
export type QwenChoice = z.infer<typeof QwenChoiceSchema>;

/**
 * Output container in the DashScope response.
 * `text` and `finish_reason` are the legacy fields used when `result_format` is `"text"`.
 */
export const QwenOutputSchema = z.object({
  choices: z.array(QwenChoiceSchema).default(() => []),
  text: z.string().nullable().default(null),
  finish_reason: z.string().nullable().default(null),
});
export type QwenOutput = z.infer<typeof QwenOutputSchema>;

/** Token usage from a DashScope response. */
export const QwenUsageSchema = z.object({
  input_tokens: z.number().int().default(0),
  output_tokens: z.number().int().default(0),
  total_tokens: z.number().int().default(0),
});
export type QwenUsage = z.infer<typeof QwenUsageSchema>;

/** DashScope native generation response. Unknown extra fields are kept. */
export const QwenResponseSchema = z.looseObject({
  output: QwenOutputSchema.default(() => ({ choices: [], text: null, finish_reason: null })),
  usage: QwenUsageSchema.default(() => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })),
  request_id: z.string().nullable().default(null),
});
export type QwenResponse = z.infer<typeof QwenResponseSchema>;

/** One streamed DashScope frame: a response whose `usage` may be missing. */
export const QwenStreamChunkSchema = QwenResponseSchema.extend({
  usage: QwenUsageSchema.nullable().default(null),
});
export type QwenStreamChunk = z.infer<typeof QwenStreamChunkSchema>;
