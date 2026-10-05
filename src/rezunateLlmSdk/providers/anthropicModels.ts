/**
 * Anthropic-specific models.
 * These represent Anthropic's API request/response format, used by the Anthropic provider.
 */

import { z } from "zod";

// ---- Content blocks (used in both request and response) --------------------------------

/** A text content block. */
export const AnthropicTextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().default(""),
});
export type AnthropicTextBlock = z.infer<typeof AnthropicTextBlockSchema>;

/** A `tool_use` block: the assistant requesting a tool call. */
export const AnthropicToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type AnthropicToolUseBlock = z.infer<typeof AnthropicToolUseBlockSchema>;

/** A `tool_result` block: the tool's output, sent under a user-role message. */
export const AnthropicToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(AnthropicTextBlockSchema)]).default(""),
});
export type AnthropicToolResultBlock = z.infer<typeof AnthropicToolResultBlockSchema>;

/** Any content block, picked by its `type` field. */
export const AnthropicContentBlockSchema = z.discriminatedUnion("type", [
  AnthropicTextBlockSchema,
  AnthropicToolUseBlockSchema,
  AnthropicToolResultBlockSchema,
]);
export type AnthropicContentBlock = z.infer<typeof AnthropicContentBlockSchema>;

// ---- Tool surface ----------------------------------------------------------------------

/** Anthropic-shaped tool definition. */
export const AnthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  input_schema: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type AnthropicTool = z.infer<typeof AnthropicToolSchema>;

/** Tool choice: `auto` (model decides), `any` (must call one tool) or `tool` (this tool). */
export const AnthropicToolChoiceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auto") }),
  z.object({ type: z.literal("any") }),
  z.object({ type: z.literal("tool"), name: z.string() }),
]);
export type AnthropicToolChoice = z.infer<typeof AnthropicToolChoiceSchema>;

// ---- Request ---------------------------------------------------------------------------

/** Message in Anthropic format: plain text, or a list of typed content blocks. */
export const AnthropicMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
});
export type AnthropicMessage = z.infer<typeof AnthropicMessageSchema>;

/** Anthropic API request format. Unknown extra fields are kept. */
export const AnthropicRequestSchema = z.looseObject({
  model: z.string(),
  max_tokens: z.number().int().default(1024),
  messages: z.array(AnthropicMessageSchema),
  system: z.string().nullish(),
  temperature: z.number().nullish(),
  top_k: z.number().int().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  tools: z.array(AnthropicToolSchema).nullish(),
  tool_choice: AnthropicToolChoiceSchema.nullish(),
});
export type AnthropicRequest = z.infer<typeof AnthropicRequestSchema>;

// ---- Response --------------------------------------------------------------------------

/** Token usage in Anthropic format. */
export const AnthropicUsageSchema = z.object({
  input_tokens: z.number().int().default(0),
  output_tokens: z.number().int().default(0),
});
export type AnthropicUsage = z.infer<typeof AnthropicUsageSchema>;

/**
 * Stop reasons Anthropic documents today (all translated by FINISH_REASON_MAP).
 * The response accepts any other value too, so a new one never breaks a reply.
 */
export const ANTHROPIC_STOP_REASONS = [
  "end_turn",
  "stop_sequence",
  "max_tokens",
  "tool_use",
  "refusal",
  "model_context_window_exceeded",
  "pause_turn",
] as const;

/** Anthropic API response format. */
export const AnthropicResponseSchema = z.object({
  id: z.string().default(""),
  type: z.literal("message").default("message"),
  role: z.literal("assistant").default("assistant"),
  model: z.string().default(""),
  content: z.array(AnthropicContentBlockSchema).default(() => []),
  stop_reason: z.string().nullable().default(null),
  usage: AnthropicUsageSchema.default(() => ({ input_tokens: 0, output_tokens: 0 })),
});
export type AnthropicResponse = z.infer<typeof AnthropicResponseSchema>;
