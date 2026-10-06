/**
 * Base Provider Class.
 * All providers inherit from this class.
 */

import type { z } from "zod";
import * as constants from "../constants";
import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChoiceDelta,
  type ErrorInfo,
  mapFinishReason,
  type Provider,
  type Usage,
} from "../models";
import { parseSseLines, readLines } from "../streaming/sseParser";
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

/** The same error `AbortSignal.timeout()` raises, so timeouts are retried the same way. */
function timeoutError(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

/**
 * Pass the body through, aborting when no data arrives for `ms` milliseconds.
 * Like httpx's read timeout: a long stream is fine as long as data keeps coming.
 */
async function* withIdleTimeout(
  body: AsyncIterable<Uint8Array>,
  controller: AbortController,
  ms: number,
): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    while (true) {
      const timer = setTimeout(() => controller.abort(timeoutError()), ms);
      let result: IteratorResult<Uint8Array>;
      try {
        result = await iterator.next();
      } finally {
        clearTimeout(timer);
      }
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    // Closes the connection when the caller stops reading early.
    await iterator.return?.();
  }
}

/** The `error` field shared by error responses and error chunks. */
function errorInfo(error: unknown): ErrorInfo {
  const retriesAttempted =
    error !== null && typeof error === "object" && RETRIES_ATTEMPTED in error
      ? (error as { [RETRIES_ATTEMPTED]: number })[RETRIES_ATTEMPTED]
      : null;

  return {
    message: error instanceof Error ? error.message : String(error),
    type: "api_error",
    code: statusCodeOf(error),
    retries_attempted: retriesAttempted,
  };
}

/** Terminal-error chunk; also used by the gateway when no provider could be created. */
export function makeErrorChunk(
  error: unknown,
  model: string | null = null,
  provider: Provider | null = null,
): ChatCompletionChunk {
  return {
    id: null,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage: null,
    provider,
    error: errorInfo(error),
  };
}

/** Per-stream state passed to the translation hooks. */
export interface StreamState {
  id: string;
  model: string | null;
  created: number;
  inputTokens: number;
  roleSent: boolean;
}

/** URL, body and headers for the streaming POST. */
export interface StreamRequest {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Fields for `makeChunk`; `finishReason` is the provider's own value, mapped by `makeChunk`. */
export interface ChunkFields {
  delta?: Partial<ChoiceDelta>;
  finishReason?: string | null;
  usage?: Usage | null;
}

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
    this.timeout = options.timeout ?? constants.DEFAULT_TIMEOUT;
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
    return this.withRetries(() => this.sendRequest(providerRequest, model));
  }

  /** Run `attemptFn`, retrying it on retryable errors. Used by chat and by stream start. */
  protected async withRetries<T>(attemptFn: () => Promise<T>): Promise<T> {
    // Retry loop
    for (let attempt = 0; ; attempt++) {
      try {
        return await attemptFn();
      } catch (error) {
        // Check if we should retry
        const retryable =
          this.isRetryable(statusCodeOf(error)) || isTimeoutOrConnectionError(error);

        if (attempt < this.maxRetries && retryable) {
          await sleep(this.calculateBackoff(attempt));
          continue;
        }

        // No more retries: record how many were made, for the error response.
        // Replaceable, so a reused error object can get a new count; a frozen error keeps none.
        if (error !== null && typeof error === "object") {
          try {
            Object.defineProperty(error, RETRIES_ATTEMPTED, {
              value: attempt,
              writable: true,
              configurable: true,
            });
          } catch {
            // The error can't be changed: pass it on without the retry count.
          }
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
    return {
      id: null,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model ?? null,
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      provider: this.providerName,
      error: errorInfo(error),
    };
  }

  // Streaming

  /**
   * Streaming chat completion, driven through SSE. Override for SDK-based streaming.
   * Only opening the stream is retried; any failure ends the stream with an error chunk.
   */
  async *stream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk> {
    const state = this.newStreamState(request);
    try {
      const { url, body, headers } = this.buildStreamRequest(request);
      // Once text has arrived, a retry would repeat it, so only the start is retried.
      const lines = await this.withRetries(() => this.streamHttpLines(url, body, headers));
      for await (const { event, data } of parseSseLines(lines)) {
        if (this.isStreamTerminator(event, data)) {
          return;
        }
        const chunk = this.translateFrame(event, data, state);
        if (chunk) {
          yield chunk;
        }
      }
    } catch (error) {
      yield this.errorChunk(error, request.model);
    }
  }

  // ---- hooks (override in native-protocol providers) ----

  /** Per-stream state. Defaults to a fresh `StreamState`. */
  protected newStreamState(request: ChatCompletionRequest): StreamState {
    return {
      id: `chatcmpl-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
      model: request.model,
      created: Math.floor(Date.now() / 1000),
      inputTokens: 0,
      roleSent: false,
    };
  }

  /** Return the URL, body and headers for the streaming POST. */
  protected buildStreamRequest(_request: ChatCompletionRequest): StreamRequest {
    throw new Error(`${this.constructor.name} does not implement buildStreamRequest`);
  }

  /** Translate one SSE frame into a chunk, or `null` to skip it. */
  protected translateFrame(
    _event: string,
    _data: string,
    _state: StreamState,
  ): ChatCompletionChunk | null {
    throw new Error(`${this.constructor.name} does not implement translateFrame`);
  }

  /** Return `true` when this frame ends the stream. */
  protected isStreamTerminator(_event: string, _data: string): boolean {
    return false;
  }

  // ---- shared helpers ----

  /** Parse a JSON SSE frame payload. Returns `null` if empty or malformed. */
  protected static parseJsonFrame(data: string): unknown {
    if (!data) {
      return null;
    }
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /** Build a chunk from stream state; the finish reason is mapped and the original kept. */
  protected makeChunk(state: StreamState, fields: ChunkFields = {}): ChatCompletionChunk {
    const finishReason = fields.finishReason ?? null;
    return {
      id: state.id,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta: { role: null, content: null, ...fields.delta },
          finish_reason: finishReason === null ? null : mapFinishReason(finishReason),
          provider_finish_reason: finishReason,
        },
      ],
      usage: fields.usage ?? null,
      provider: this.providerName,
      error: null,
    };
  }

  /** Terminal-error chunk, with the same `error` field as `handleError`. */
  protected errorChunk(error: unknown, model?: string | null): ChatCompletionChunk {
    return makeErrorChunk(error, model ?? null, this.providerName);
  }

  /**
   * Open one streaming POST (no retry) and return its text lines.
   * The timeout restarts whenever data arrives, so long streams are not cut off.
   */
  protected async streamHttpLines(
    url: string,
    body: unknown,
    headers: Record<string, string> = this.getHeaders(),
  ): Promise<AsyncIterable<string>> {
    const ms = this.timeout * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(timeoutError()), ms);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(dropNones(body)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new HttpError(response.status, response.statusText, url);
    }
    return readLines(withIdleTimeout(response.body, controller, ms));
  }
}
