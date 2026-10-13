/**
 * Google Gemini-specific models.
 * These represent Gemini's API request/response format, used by the Google provider.
 */

import { z } from "zod";

/** A `functionCall` part: the model requesting a tool call. */
export const GoogleFunctionCallSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type GoogleFunctionCall = z.infer<typeof GoogleFunctionCallSchema>;

/** A `functionResponse` part: the result of a tool execution. */
export const GoogleFunctionResponseSchema = z.object({
  name: z.string(),
  response: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type GoogleFunctionResponse = z.infer<typeof GoogleFunctionResponseSchema>;

// ---- Request ---------------------------------------------------------------------------

/**
 * A single `part` inside a Gemini message.
 * Only one of `text`, `functionCall` or `functionResponse` is set per part.
 */
export const GoogleContentBlockSchema = z.looseObject({
  text: z.string().nullish(),
  functionCall: GoogleFunctionCallSchema.nullish(),
  functionResponse: GoogleFunctionResponseSchema.nullish(),
});
export type GoogleContentBlock = z.infer<typeof GoogleContentBlockSchema>;

/** Message in Google format, with a role (`user` or `model`) and parts. */
export const GoogleMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  parts: z.array(GoogleContentBlockSchema),
});
export type GoogleMessage = z.infer<typeof GoogleMessageSchema>;

/** System instruction container. */
export const GoogleSystemInstructionSchema = z.object({
  parts: z.array(GoogleContentBlockSchema),
});
export type GoogleSystemInstruction = z.infer<typeof GoogleSystemInstructionSchema>;

/** Generation settings (temperature, max output tokens, top-k). Unknown extra fields are kept. */
export const GoogleGenerationConfigSchema = z.looseObject({
  temperature: z.number().nullish(),
  maxOutputTokens: z.number().int().nullish(),
  topK: z.number().int().nullish(),
});
export type GoogleGenerationConfig = z.infer<typeof GoogleGenerationConfigSchema>;

// ---- Tool surface ----------------------------------------------------------------------

/** Gemini-shaped tool function declaration. */
export const GoogleFunctionDeclarationSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  parameters: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type GoogleFunctionDeclaration = z.infer<typeof GoogleFunctionDeclarationSchema>;

/** Outer `tools` entry containing a batch of function declarations. */
export const GoogleToolSchema = z.object({
  functionDeclarations: z.array(GoogleFunctionDeclarationSchema).default(() => []),
});
export type GoogleTool = z.infer<typeof GoogleToolSchema>;

/** `toolConfig.functionCallingConfig`: the mode plus an optional list of allowed functions. */
export const GoogleFunctionCallingConfigSchema = z.object({
  mode: z.enum(["AUTO", "NONE", "ANY"]).default("AUTO"),
  allowedFunctionNames: z.array(z.string()).nullish(),
});
export type GoogleFunctionCallingConfig = z.infer<typeof GoogleFunctionCallingConfigSchema>;

/** Outer `toolConfig` payload. */
export const GoogleToolConfigSchema = z.object({
  functionCallingConfig: GoogleFunctionCallingConfigSchema,
});
export type GoogleToolConfig = z.infer<typeof GoogleToolConfigSchema>;

/** Google Gemini API request format. Unknown extra fields are kept. */
export const GoogleRequestSchema = z.looseObject({
  contents: z.array(GoogleMessageSchema),
  systemInstruction: GoogleSystemInstructionSchema.nullish(),
  generationConfig: GoogleGenerationConfigSchema.nullish(),
  safetySettings: z.unknown().nullish(),
  tools: z.array(GoogleToolSchema).nullish(),
  toolConfig: GoogleToolConfigSchema.nullish(),
});
export type GoogleRequest = z.infer<typeof GoogleRequestSchema>;

// ---- Response --------------------------------------------------------------------------

/** Candidate (one possible answer) in a Google response. */
export const GoogleCandidateSchema = z.object({
  content: GoogleMessageSchema.nullable().default(null),
  finishReason: z.string().nullable().default(null),
});
export type GoogleCandidate = z.infer<typeof GoogleCandidateSchema>;

/** Token usage in Google format. */
export const GoogleUsageSchema = z.object({
  promptTokenCount: z.number().int().default(0),
  candidatesTokenCount: z.number().int().default(0),
  totalTokenCount: z.number().int().default(0),
});
export type GoogleUsage = z.infer<typeof GoogleUsageSchema>;

/**
 * Feedback on the prompt. When Gemini blocks the prompt itself, it returns no candidates
 * and gives the reason here (e.g. "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "OTHER").
 */
export const GooglePromptFeedbackSchema = z.looseObject({
  blockReason: z.string().nullable().default(null),
});
export type GooglePromptFeedback = z.infer<typeof GooglePromptFeedbackSchema>;

/** Google Gemini API response format. */
export const GoogleResponseSchema = z.object({
  candidates: z.array(GoogleCandidateSchema).default(() => []),
  promptFeedback: GooglePromptFeedbackSchema.nullable().default(null),
  usageMetadata: GoogleUsageSchema.default(() => ({
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
  })),
});
export type GoogleResponse = z.infer<typeof GoogleResponseSchema>;
