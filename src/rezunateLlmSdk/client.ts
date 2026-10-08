/** RouterClient: HTTP transport for the Rezunate LLM API. */

import { STATUS_CODES } from "node:http";
import * as constants from "./constants";

/** Longest error body kept in a message when the server sends no `detail`. */
const MAX_DETAIL_LENGTH = 500;

/** Raised when a Rezunate LLM API call fails. */
export class RouterAPIError extends Error {
  /** HTTP status code, or null when the request never got a response. */
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "RouterAPIError";
    this.statusCode = statusCode;
  }
}

export interface RouterClientOptions {
  /** API key; defaults to the `REZUNATE_LLM_API_KEY` env var. */
  apiKey?: string;
  /** Request timeout in seconds. */
  timeout?: number;
}

export interface RouterRequestOptions {
  /** Query parameters; undefined values are left out. */
  params?: Record<string, string | number | undefined>;
  /** JSON request body. */
  json?: unknown;
  headers?: Record<string, string>;
  /** Overrides the client's timeout for this request, in seconds. */
  timeout?: number;
}

/**
 * HTTP client for the Rezunate LLM API.
 * Attaches the API key, sends the request, and throws `RouterAPIError` on failure.
 */
export class RouterClient {
  readonly apiKey: string;
  readonly timeout: number;
  readonly baseUrl: string;

  constructor(options: RouterClientOptions = {}) {
    this.apiKey = options.apiKey || process.env[constants.REZUNATE_LLM_API_KEY_ENV] || "";
    this.timeout = options.timeout ?? constants.REZUNATE_LLM_TIMEOUT;
    this.baseUrl =
      process.env[constants.REZUNATE_LLM_BASE_URL_ENV] || constants.REZUNATE_LLM_DEFAULT_BASE_URL;

    if (!this.apiKey) {
      throw new RouterAPIError(
        `apiKey is required (or set ${constants.REZUNATE_LLM_API_KEY_ENV} env var)`,
      );
    }
  }

  /** Send an authenticated request, e.g. `request("GET", "/api/v1/prompts/my-slug")`. */
  async request(
    method: string,
    path: string,
    options: RouterRequestOptions = {},
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }
    const timeout = options.timeout ?? this.timeout;
    const hasBody = options.json !== undefined;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          [constants.API_KEY_HEADER]: this.apiKey,
          ...(hasBody ? { [constants.CONTENT_TYPE_HEADER]: constants.APPLICATION_JSON } : {}),
          ...options.headers,
        },
        body: hasBody ? JSON.stringify(options.json) : undefined,
        signal: AbortSignal.timeout(timeout * 1000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new RouterAPIError(
          `Rezunate LLM API request timed out after ${timeout}s: ${method} ${path}`,
          null,
          { cause: error },
        );
      }
      // fetch reports network failures as TypeError("fetch failed"); anything else is a bug.
      if (error instanceof TypeError && error.message === "fetch failed") {
        throw new RouterAPIError(`Cannot connect to Rezunate LLM API at ${this.baseUrl}`, null, {
          cause: error,
        });
      }
      throw error;
    }

    if (!response.ok) {
      throw new RouterAPIError(await errorDetail(response), response.status);
    }
    return response;
  }
}

/** A short `HTTP <code> <reason>` summary, e.g. `HTTP 504 Gateway Timeout`. */
function statusSummary(response: Response): string {
  const reason = response.statusText || STATUS_CODES[response.status] || "";
  return `HTTP ${response.status} ${reason}`.trim();
}

/**
 * A readable error message from a failed response: the JSON `detail` field when there is one,
 * otherwise a status summary (e.g. for a proxy's HTML error page).
 */
async function errorDetail(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return statusSummary(response);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return statusSummary(response);
  }

  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    if ("detail" in payload) {
      const { detail } = payload;
      return typeof detail === "string" ? detail : JSON.stringify(detail);
    }
  }
  return JSON.stringify(payload).slice(0, MAX_DETAIL_LENGTH);
}
