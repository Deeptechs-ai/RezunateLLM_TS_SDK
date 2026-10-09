/** Gateway - routes chat completion requests to providers. */

import { getPrompt as fetchPrompt } from "./api";
import { RouterClient } from "./client";
import { applyGuardrails, automaticGuardrails, GuardrailsError } from "./guardrails";
import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
  GuardrailDirection,
  type GuardrailsConfig,
  type Provider,
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
  /**
   * Guardrail rules checked on the messages and the reply. Without it, the file named by the
   * `GUARDRAILS_FILE_PATH` env var is used, if any.
   */
  guardrailsConfig?: GuardrailsConfig | null;
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
  const config = options.guardrailsConfig ?? automaticGuardrails();
  if (config) {
    guardInput(request, options.request, config);
  }

  const providerInstance = createProvider(options, request);
  const response = await providerInstance.chatComplete(request);

  if (config) {
    guardOutput(response, config);
  }
  return response;
}

async function* streamChat(options: ChatCompleteOptions): AsyncGenerator<ChatCompletionChunk> {
  let request: ChatCompletionRequest;
  let config: GuardrailsConfig | null;
  let providerInstance: ReturnType<typeof createProvider>;
  try {
    request = ChatCompletionRequestSchema.parse(options.request);
    config = options.guardrailsConfig ?? automaticGuardrails();
    if (config) {
      guardInput(request, options.request, config);
    }
    providerInstance = createProvider(options, request);
  } catch (error) {
    yield* errorStream(error, options.request?.model);
    return;
  }

  if (!config) {
    yield* providerInstance.stream(request);
    return;
  }
  // Chunks are only checked here: a pattern can be split across chunks, so flag and redact
  // only warn (as in the Python SDK), while block ends the stream with an error chunk.
  for await (const chunk of providerInstance.stream(request)) {
    try {
      for (const choice of chunk.choices) {
        if (choice.delta.content) {
          applyGuardrails(choice.delta.content, config, GuardrailDirection.OUTPUT);
        }
      }
    } catch (error) {
      yield* errorStream(error, chunk.model, chunk.provider);
      return;
    }
    yield chunk;
  }
}

/**
 * Check every message before it's sent. `redact` changes the message in place, as in the
 * Python SDK. zod's parse returns a copy, so the caller's own message is updated as well.
 */
function guardInput(
  request: ChatCompletionRequest,
  callerRequest: ChatCompletionRequest,
  config: GuardrailsConfig,
): void {
  for (const [i, message] of request.messages.entries()) {
    if (!message.content) {
      continue;
    }
    const redacted = applyGuardrails(message.content, config, GuardrailDirection.INPUT);
    if (redacted !== message.content) {
      message.content = redacted;
      const callerMessage = callerRequest.messages[i];
      if (callerMessage) {
        callerMessage.content = redacted;
      }
    }
  }
}

/** Check every choice of a reply; `redact` replaces the text in the reply. */
function guardOutput(response: ChatCompletionResponse, config: GuardrailsConfig): void {
  for (const choice of response.choices) {
    if (choice.message.content) {
      choice.message.content = applyGuardrails(
        choice.message.content,
        config,
        GuardrailDirection.OUTPUT,
      );
    }
  }
}

/**
 * A stream that ends with one error chunk, so a streaming request never throws.
 * A guardrail block gets the type "guardrail_error"; anything else is an invalid request.
 */
async function* errorStream(
  error: unknown,
  model: unknown,
  provider: Provider | null = null,
): AsyncGenerator<ChatCompletionChunk> {
  yield makeErrorChunk(
    error,
    typeof model === "string" ? model : null,
    provider,
    error instanceof GuardrailsError ? "guardrail_error" : "invalid_request_error",
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

/** Settings a `Gateway` remembers. Server guardrail options will come with that feature. */
export interface GatewayOptions {
  /** Provider used when a call doesn't name one. */
  defaultProvider?: string;
  /** Provider API key used when a call doesn't pass one. */
  defaultApiKey?: string;
  /** API key for the Rezunate LLM API (prompts); defaults to the `REZUNATE_LLM_API_KEY` env var. */
  rezunateLlmApiKey?: string;
  /** Guardrail rules checked on every call, unless a call passes its own. */
  guardrailsConfig?: GuardrailsConfig;
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
  readonly guardrailsConfig: GuardrailsConfig | null;
  private readonly rezunateLlmApiKey: string | null;
  private cachedClient: RouterClient | null = null;

  constructor(options: GatewayOptions = {}) {
    this.defaultProvider = options.defaultProvider ?? null;
    this.defaultApiKey = options.defaultApiKey ?? null;
    this.guardrailsConfig = options.guardrailsConfig ?? null;
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
      return request?.stream === true ? errorStream(error, request.model) : Promise.reject(error);
    }
    const guardrailsConfig = options.guardrailsConfig ?? this.guardrailsConfig;
    return chatComplete({ ...options, provider, apiKey, request, guardrailsConfig });
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
