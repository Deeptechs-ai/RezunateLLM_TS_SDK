/** Global constants for Rezunate LLM. */

// HTTP Headers
export const CONTENT_TYPE_HEADER = "Content-Type";
export const APPLICATION_JSON = "application/json";
export const AUTHORIZATION_HEADER = "Authorization";
export const API_KEY_HEADER = "x-api-key";
export const GOOGLE_API_KEY_HEADER = "x-goog-api-key";
export const ANTHROPIC_VERSION_HEADER = "anthropic-version";
export const ANTHROPIC_WORKSPACE_HEADER = "anthropic-workspace-id";

// Retry Configuration
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY = 1.0; // seconds
export const DEFAULT_TIMEOUT = 60.0; // seconds
export const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

// Rezunate LLM API (prompts; guardrails later)
export const REZUNATE_LLM_DEFAULT_BASE_URL = "https://rezunatellm.com";
/** Env var that overrides the base URL (e.g. a local server). */
export const REZUNATE_LLM_BASE_URL_ENV = "REZUNATE_LLM_BASE_URL";
/** Env var read when no Rezunate API key is passed. */
export const REZUNATE_LLM_API_KEY_ENV = "REZUNATE_LLM_API_KEY";
export const REZUNATE_LLM_TIMEOUT = 30; // seconds
export const REZUNATE_LLM_API_VERSION = "v1";
export const PROMPT_ENDPOINT = `/api/${REZUNATE_LLM_API_VERSION}/prompts`;

// Local guardrails
/** Env var with the path of a guardrails YAML file that is loaded automatically. */
export const GUARDRAILS_FILE_PATH_ENV = "GUARDRAILS_FILE_PATH";
/** Text that replaces each match of a `redact` rule that sets no `replacement`. */
export const DEFAULT_REDACTION = "[REDACTED]";

// Provider finish/stop reasons (reference lists; FINISH_REASON_MAP in models.ts translates them)

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

/**
 * Finish reasons Gemini documents today for text (all translated by FINISH_REASON_MAP).
 * The response accepts any other value too, so a new one never breaks a reply.
 */
export const GOOGLE_FINISH_REASONS = [
  "FINISH_REASON_UNSPECIFIED",
  "STOP",
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "OTHER",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
  "UNEXPECTED_TOOL_CALL",
  "TOO_MANY_TOOL_CALLS",
  "CONTINUATION",
  "FUNCTION_CALL",
] as const;

// Tool Calls
export const DEFAULT_TOOL_NAME = "tool"; // Gemini tool-result name when none is known
