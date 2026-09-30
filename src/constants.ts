/** Global constants for Rezunate LLM. */

// HTTP Headers
export const CONTENT_TYPE_HEADER = "Content-Type";
export const APPLICATION_JSON = "application/json";
export const AUTHORIZATION_HEADER = "Authorization";
export const API_KEY_HEADER = "x-api-key";
export const ANTHROPIC_VERSION_HEADER = "anthropic-version";

// Retry Configuration
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY = 1.0; // seconds
export const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
