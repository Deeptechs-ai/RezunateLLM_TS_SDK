/** Gateway - routes chat completion requests to providers. */

import { getPrompt as fetchPrompt } from "./api";
import { RouterClient } from "./client";
import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
} from "./models";
import { renderPrompt } from "./prompts";
import { getProvider, listProviders } from "./providers";
import { makeErrorChunk } from "./providers/base";

/** Options for `chatComplete`: which provider to use, its API key, and the request. */
export interface ChatCompleteOptions {
  provider: string;
  apiKey: string;
  request: ChatCompletionRequest;
  /** OpenAI organization ID (OpenAI only), for keys that belong to several organizations. */
  organization?: string;
  /** OpenAI project ID (OpenAI only), for keys that access several projects. */
  project?: string;
  /** Workspace ID for organization-level keys (Anthropic and Qwen). */
  workspaceId?: string;
}

/**
 * Execute a chat completion with the specified provider.
 * With `stream: true`, returns the chunks instead; every problem comes as an error chunk.
 * Otherwise the request is validated first; provider errors come back in `response.error`.
 */
export function chatComplete(
  options: ChatCompleteOptions & { request: { stream: true } },
): AsyncIterable<ChatCompletionChunk>;
export function chatComplete(
  options: ChatCompleteOptions & { request: { stream?: false | null } },
): Promise<ChatCompletionResponse>;
export function chatComplete(
  options: ChatCompleteOptions,
): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk>;
export function chatComplete(
  options: ChatCompleteOptions,
): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk> {
  // Checked before validation, so an invalid streaming request also becomes an error chunk.
  if (options.request?.stream === true) {
    return streamChat(options);
  }
  return complete(options);
}

async function complete(options: ChatCompleteOptions): Promise<ChatCompletionResponse> {
  const request = ChatCompletionRequestSchema.parse(options.request);
  const providerInstance = createProvider(options, request);
  return providerInstance.chatComplete(request);
}

async function* streamChat(options: ChatCompleteOptions): AsyncGenerator<ChatCompletionChunk> {
  let request: ChatCompletionRequest;
  let providerInstance: ReturnType<typeof createProvider>;
  try {
    request = ChatCompletionRequestSchema.parse(options.request);
    providerInstance = createProvider(options, request);
  } catch (error) {
    yield* invalidRequestStream(error, options.request?.model);
    return;
  }
  yield* providerInstance.stream(request);
}

/** A stream with one error chunk, for a streaming request that is invalid (nothing throws). */
async function* invalidRequestStream(
  error: unknown,
  model: unknown,
): AsyncGenerator<ChatCompletionChunk> {
  yield makeErrorChunk(
    error,
    typeof model === "string" ? model : null,
    null,
    "invalid_request_error",
  );
}

function createProvider(options: ChatCompleteOptions, request: ChatCompletionRequest) {
  return getProvider(options.provider, options.apiKey, {
    model: request.model,
    organization: options.organization,
    project: options.project,
    workspaceId: options.workspaceId,
  });
}

/** Get the list of available provider names. */
export function getAvailableProviders(): string[] {
  return listProviders();
}

/** Settings a `Gateway` remembers. Guardrail options will be added with the guardrails feature. */
export interface GatewayOptions {
  /** Provider used when a call doesn't name one. */
  defaultProvider?: string;
  /** Provider API key used when a call doesn't pass one. */
  defaultApiKey?: string;
  /** API key for the Rezunate LLM API (prompts); defaults to the `REZUNATE_LLM_API_KEY` env var. */
  rezunateLlmApiKey?: string;
}

/** Per-call options for `Gateway.chatComplete`; anything left out uses the gateway's defaults. */
export type GatewayChatOptions = Partial<Omit<ChatCompleteOptions, "request">>;

/**
 * One object that remembers your settings: the default provider and its key for chat, and the
 * Rezunate LLM API key for prompts.
 */
export class Gateway {
  readonly defaultProvider: string | null;
  readonly defaultApiKey: string | null;
  private readonly rezunateLlmApiKey: string | null;
  private cachedClient: RouterClient | null = null;

  constructor(options: GatewayOptions = {}) {
    this.defaultProvider = options.defaultProvider ?? null;
    this.defaultApiKey = options.defaultApiKey ?? null;
    this.rezunateLlmApiKey = options.rezunateLlmApiKey ?? null;
  }

  /** The Rezunate LLM API client, created on first use, so chat alone needs no Rezunate key. */
  get client(): RouterClient {
    this.cachedClient ??= new RouterClient(
      this.rezunateLlmApiKey ? { apiKey: this.rezunateLlmApiKey } : {},
    );
    return this.cachedClient;
  }

  /** The names of the available providers. */
  get providers(): string[] {
    return listProviders();
  }

  /**
   * Execute a chat completion, using the gateway's defaults for anything not passed.
   * Errors follow `chatComplete`: with `stream: true`, every problem comes as an error chunk.
   */
  chatComplete(
    request: ChatCompletionRequest & { stream: true },
    options?: GatewayChatOptions,
  ): AsyncIterable<ChatCompletionChunk>;
  chatComplete(
    request: ChatCompletionRequest & { stream?: false | null },
    options?: GatewayChatOptions,
  ): Promise<ChatCompletionResponse>;
  chatComplete(
    request: ChatCompletionRequest,
    options?: GatewayChatOptions,
  ): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk>;
  chatComplete(
    request: ChatCompletionRequest,
    options: GatewayChatOptions = {},
  ): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk> {
    const provider = options.provider || this.defaultProvider;
    const apiKey = options.apiKey || this.defaultApiKey;
    if (!provider || !apiKey) {
      const error = new Error(
        provider ? "API key must be specified" : "Provider must be specified",
      );
      return request?.stream === true
        ? invalidRequestStream(error, request.model)
        : Promise.reject(error);
    }
    return chatComplete({ ...options, provider, apiKey, request });
  }

  /**
   * Fetch a prompt from the Rezunate LLM API and fill in its `{{variables}}`.
   * Throws `RouterAPIError` if the prompt can't be fetched, or an error if a variable is missing.
   */
  async getPrompt(
    slugId: string,
    variables?: Readonly<Record<string, string>> | null,
    version?: number | null,
  ): Promise<string> {
    const prompt = await fetchPrompt(this.client, slugId, version);
    return renderPrompt(prompt.content, variables);
  }
}
