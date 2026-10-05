/**
 * Base Provider Class.
 * All providers inherit from this class.
 */

import type { z } from "zod";
import * as constants from "../constants";
import type { ChatCompletionRequest, ChatCompletionResponse, Provider } from "../models";
import { getUrl } from "./endpoints";

/** Settings shared by every provider. Times are in seconds, as in the Python SDK. */
export interface ProviderOptions {
  apiKey: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  /** Accepted for parity with the Python `**kwargs`; providers may ignore it. */
  model?: string;
  /** OpenAI organization ID, for keys that belong to several organizations. Used by OpenAI only. */
  organization?: string;
  /** OpenAI project ID, for keys that access several projects. Used by OpenAI only. */
  project?: string;
  /**
   * Workspace ID for organization-level keys.
   * Anthropic sends it as a header; Qwen uses it in the workspace URL. Other providers ignore it.
   */
  workspaceId?: string;
}

/** Raised for a non-2xx HTTP response, carrying the status code (like `requests.HTTPError`). */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string, url: string) {
    super(`${status} ${statusText} for url: ${url}`);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Return a copy without `null`/`undefined` values, at any depth.
 * The TS counterpart of pydantic's `model_dump(exclude_none=True)`.
 */
export function dropNones<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => dropNones(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && item !== undefined) {
        result[key] = dropNones(item);
      }
    }
    return result as T;
  }
  return value;
}

/** The HTTP status code carried by an error, if any (our `HttpError` or the `openai` SDK's errors). */
function statusCodeOf(error: unknown): number | null {
  if (error !== null && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return null;
}

/** Error names the `openai` SDK uses for timeouts and network failures. */
const SDK_CONNECTION_ERRORS = new Set(["APIConnectionError", "APIConnectionTimeoutError"]);

/** Whether an error is a timeout or a network failure (both are retried). */
function isTimeoutOrConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    // fetch: AbortSignal.timeout() rejects with "TimeoutError"; a network failure rejects with
    // TypeError("fetch failed"). Other TypeErrors are bugs and are not retried (as in Python).
    return (
      error.name === "TimeoutError" ||
      (error instanceof TypeError && error.message === "fetch failed") ||
      SDK_CONNECTION_ERRORS.has(error.constructor.name)
    );
  }
  return false;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** Number of retries made before a request finally failed, attached to the thrown error. */
const RETRIES_ATTEMPTED = Symbol("retriesAttempted");

/**
 * Abstract base class for all providers.
 * Each provider must implement the abstract members.
 */
export abstract class BaseProvider {
  readonly apiKey: string;
  readonly maxRetries: number;
  readonly retryDelay: number;
  readonly timeout: number;
  readonly organization: string | null;
  readonly project: string | null;
  readonly workspaceId: string | null;

  /** When set, raw provider responses are validated with this schema. */
  protected readonly responseModel: z.ZodType | null = null;

  constructor(options: ProviderOptions) {
    // Python's ABC refuses to instantiate BaseProvider itself; do the same at runtime.
    if (new.target === BaseProvider) {
      throw new TypeError("Cannot instantiate abstract class BaseProvider");
    }
    this.apiKey = options.apiKey;
    this.maxRetries = options.maxRetries ?? constants.DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay ?? constants.DEFAULT_RETRY_DELAY;
    this.timeout = options.timeout ?? 60.0;
    this.organization = options.organization ?? null;
    this.project = options.project ?? null;
    this.workspaceId = options.workspaceId ?? null;
  }

  /** Return the base URL for the provider's API. */
  abstract get baseUrl(): string;

  /** Return the provider name. */
  abstract get providerName(): Provider;

  /** Return the headers required for API calls. */
  abstract getHeaders(): Record<string, string>;

  /** Return the chat completion endpoint. */
  abstract getEndpoint(model?: string | null): string;

  /**
   * Transform OpenAI format request to provider's format.
   * For OpenAI provider, this returns the request unchanged.
   */
  abstract transformRequest(request: ChatCompletionRequest): unknown;

  /** Transform provider's response to OpenAI format. */
  abstract transformResponse(response: unknown, model?: string | null): ChatCompletionResponse;

  /** Calculate exponential backoff with jitter, in seconds. */
  calculateBackoff(attempt: number): number {
    // Exponential backoff: delay * 2^attempt + random jitter
    const backoff = this.retryDelay * 2 ** attempt;
    const jitter = Math.random() * backoff * 0.1;
    return backoff + jitter;
  }

  /** Check if the error is retryable based on status code. */
  isRetryable(statusCode: number | null | undefined): boolean {
    return statusCode != null && constants.RETRYABLE_STATUS_CODES.has(statusCode);
  }

  /**
   * Execute chat completion with retry logic.
   *
   * 1. Transform request to provider format
   * 2. Execute request (with retries)
   * 3. Transform response to OpenAI format
   * 4. Return response
   *
   * Request/response failures come back as a response with `error` set, not as an exception.
   */
  async chatComplete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Transform request to provider format
    const providerRequest = this.transformRequest(request);

    // Extract model for endpoint and response transformation
    const model = request.model;

    try {
      // Execute the request (subclasses can override this to use an SDK)
      const providerResponse = await this.executeRequest(providerRequest, model);

      // Success - transform and return
      const openaiResponse = this.transformResponse(providerResponse, model);
      openaiResponse.provider = this.providerName;
      return openaiResponse;
    } catch (error) {
      // Return error in consistent OpenAI format
      return this.handleError(error, model);
    }
  }

  /**
   * Execute the request with retry logic, shared by every provider.
   * Each attempt is made by `sendRequest`; failed attempts are retried on retryable errors.
   */
  protected async executeRequest(
    providerRequest: unknown,
    model?: string | null,
  ): Promise<unknown> {
    // Retry loop
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.sendRequest(providerRequest, model);
      } catch (error) {
        // Check if we should retry
        const retryable =
          this.isRetryable(statusCodeOf(error)) || isTimeoutOrConnectionError(error);

        if (attempt < this.maxRetries && retryable) {
          await sleep(this.calculateBackoff(attempt));
          continue;
        }

        // No more retries: record how many were made, for the error response.
        if (error !== null && typeof error === "object") {
          Object.defineProperty(error, RETRIES_ATTEMPTED, { value: attempt });
        }
        throw error;
      }
    }
  }

  /**
   * Send the request once, without retrying.
   * Default implementation uses the built-in fetch; OpenAI-compatible providers use the SDK.
   */
  protected async sendRequest(providerRequest: unknown, model?: string | null): Promise<unknown> {
    const url = getUrl(this.baseUrl, this.getEndpoint(model));

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(dropNones(providerRequest)),
      signal: AbortSignal.timeout(this.timeout * 1000),
    });
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, url);
    }
    const providerResponseData: unknown = await response.json();

    // Validate response using provider's model
    if (this.responseModel) {
      return this.responseModel.parse(providerResponseData);
    }
    return providerResponseData;
  }

  /** Centralized error handling for all providers. */
  protected handleError(error: unknown, model?: string | null): ChatCompletionResponse {
    const retriesAttempted =
      error !== null && typeof error === "object" && RETRIES_ATTEMPTED in error
        ? (error as { [RETRIES_ATTEMPTED]: number })[RETRIES_ATTEMPTED]
        : null;

    return {
      id: null,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model ?? null,
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      provider: this.providerName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: "api_error",
        code: statusCodeOf(error),
        retries_attempted: retriesAttempted,
      },
    };
  }
}
