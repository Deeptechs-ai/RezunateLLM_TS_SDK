/** Global constants for Rezunate LLM. */

/** Oldest Node.js major version the SDK supports (keep in step with `engines` in package.json). */
export const MIN_NODE_MAJOR = 22;

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
export const GUARDRAILS_SCAN_ENDPOINT = `/api/${REZUNATE_LLM_API_VERSION}/guardrails/scan`;
/** Scans can take a while when the PII detection service starts up. */
export const GUARDRAILS_SCAN_TIMEOUT = 180; // seconds
/**
 * Where a streamed reply is cut for scanning, so each scan sees whole sentences: ".", "!" or
 * "?" followed by a space, or a new line (never the dot inside "john.doe@acme.com").
 */
export const STREAM_SENTENCE_END = /[.!?]\s|\n/;
/** Streamed text is scanned once it has this many characters and a sentence end... */
export const STREAM_SCAN_MIN_CHARS = 200;
/** ...or once it has this many characters, whatever comes. */
export const STREAM_SCAN_MAX_CHARS = 600;

// Reversible masking
/** Hex digits of the value's hash in a placeholder, e.g. "[PERSON_7f3a]" (as the guard CLI). */
export const MASK_SUFFIX_DIGITS = 4;
/** Size of a vault's random placeholder key. */
export const MASK_KEY_BYTES = 32;
/** A streamed "[..." longer than this can't be a placeholder, so it isn't held back. */
export const MASK_MAX_PARTIAL_CHARS = 200;
/** How many messages are scanned by the hosted service at the same time. */
export const SERVER_SCAN_CONCURRENCY = 5;

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
