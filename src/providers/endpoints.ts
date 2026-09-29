/** Provider base URLs and endpoint paths. */

// OpenAI
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_CHAT_ENDPOINT = "/chat/completions";

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
