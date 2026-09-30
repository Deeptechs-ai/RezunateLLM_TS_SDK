/**
 * Llama (Meta) native API models.
 * These represent Meta's native Llama request/response format (not the /compat/v1 endpoint).
 */

import { z } from "zod";

// ---- Request ---------------------------------------------------------------------------

/** Message in Meta Llama native format. */
export const LlamaMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});
export type LlamaMessage = z.infer<typeof LlamaMessageSchema>;

/** Meta Llama native chat completion request. Unknown extra fields are kept. */
export const LlamaRequestSchema = z.looseObject({
  model: z.string(),
  messages: z.array(LlamaMessageSchema),
  max_completion_tokens: z.number().int().nullish(),
  temperature: z.number().nullish(),
  top_p: z.number().nullish(),
  top_k: z.number().int().nullish(),
  repetition_penalty: z.number().nullish(),
  stream: z.boolean().nullish(),
  tools: z.array(z.unknown()).nullish(),
  response_format: z.record(z.string(), z.unknown()).nullish(),
});
export type LlamaRequest = z.infer<typeof LlamaRequestSchema>;

// ---- Response --------------------------------------------------------------------------

/** Content block in a Meta Llama response message. */
export const LlamaContentBlockSchema = z.object({
  type: z.literal("text").default("text"),
  text: z.string().default(""),
});
export type LlamaContentBlock = z.infer<typeof LlamaContentBlockSchema>;

/** The single completion message in a Meta Llama response. */
export const LlamaCompletionMessageSchema = z.object({
  role: z.literal("assistant").default("assistant"),
  content: LlamaContentBlockSchema.default(() => ({ type: "text" as const, text: "" })),
  stop_reason: z.string().nullable().default(null),
  tool_calls: z.array(z.unknown()).nullable().default(null),
});
export type LlamaCompletionMessage = z.infer<typeof LlamaCompletionMessageSchema>;

/** A single metric entry in Meta Llama's `metrics` array, e.g. `num_prompt_tokens`. */
export const LlamaMetricSchema = z.object({
  metric: z.string(),
  value: z.number(),
  unit: z.string().nullable().default(null),
});
export type LlamaMetric = z.infer<typeof LlamaMetricSchema>;

/** Meta Llama native chat completion response. Unknown extra fields are kept. */
export const LlamaResponseSchema = z.looseObject({
  id: z.string().nullable().default(null),
  completion_message: LlamaCompletionMessageSchema.default(() => ({
    role: "assistant" as const,
    content: { type: "text" as const, text: "" },
    stop_reason: null,
    tool_calls: null,
  })),
  metrics: z.array(LlamaMetricSchema).default(() => []),
});
export type LlamaResponse = z.infer<typeof LlamaResponseSchema>;
