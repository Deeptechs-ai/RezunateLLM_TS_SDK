/** Provider base URLs and endpoint paths. */

// OpenAI
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_CHAT_ENDPOINT = "/chat/completions";

// Anthropic
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_MESSAGES_ENDPOINT = "/messages";
export const ANTHROPIC_DEFAULT_VERSION = "2023-06-01";

// Google (Gemini)
export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const GOOGLE_GENERATE_CONTENT_ENDPOINT = "/models/{model}:generateContent";
export const GOOGLE_STREAM_GENERATE_CONTENT_ENDPOINT =
  "/models/{model}:streamGenerateContent?alt=sse";

// Grok (xAI) — OpenAI-compatible API
export const GROK_BASE_URL = "https://api.x.ai/v1";
export const GROK_CHAT_ENDPOINT = "/chat/completions";

// Llama (Meta) — native API with Meta-specific schema
export const LLAMA_BASE_URL = "https://api.llama.com/v1";
export const LLAMA_CHAT_ENDPOINT = "/chat/completions";

// DeepSeek — OpenAI-compatible API
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export const DEEPSEEK_CHAT_ENDPOINT = "/chat/completions";

// Qwen (Alibaba DashScope) — native API (Singapore international region)
export const QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1";
export const QWEN_GENERATION_ENDPOINT = "/services/aigc/text-generation/generation";

/**
 * Robustly join baseUrl and endpoint.
 * Handles trailing/leading slashes and fills in `{model}` in the endpoint.
 *
 * Plain string joining on purpose: `new URL()` would percent-encode the `{model}`
 * placeholder before it is filled in.
 */
export function getUrl(baseUrl: string, endpoint: string, model?: string | null): string {
  // Ensure baseUrl ends with a slash and endpoint does NOT start with one
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = endpoint.replace(/^\/+/, "");

  const url = base + path;

  if (model) {
    return url.replaceAll("{model}", model);
  }
  return url;
}
