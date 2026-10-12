/** Gateway - routes chat completion requests to providers. */

import { getPrompt as fetchPrompt, scanText } from "./api";
import { RouterAPIError, RouterClient } from "./client";
import {
  applyGuardrails,
  automaticGuardrails,
  GuardrailsError,
  ServerGuardrailsError,
} from "./guardrails";
import { MaskVault, splitTrailingPartial } from "./masking";
import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
  GuardrailDirection,
  type GuardrailsConfig,
  type Provider,
  type ScanResponse,
  type ServerGuardrailsConfig,
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
  guardrailsConfig?: GuardrailsConfig;
  /**
   * With a vault, `redact` rules mask the messages with restorable placeholders. The reply is
   * not restored here: use `vault.restore()`, or `Gateway.chatComplete` with `reversible`.
   */
  vault?: MaskVault;
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
    guardInput(request, options.request, config, options.vault);
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
      guardInput(request, options.request, config, options.vault);
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
  vault?: MaskVault,
): void {
  for (const [i, message] of request.messages.entries()) {
    if (!message.content) {
      continue;
    }
    const redacted = applyGuardrails(message.content, config, GuardrailDirection.INPUT, vault);
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
 * Guardrail blocks get the type "guardrail_error", a failed Rezunate API call "api_error"
 * (with its status code), and anything else "invalid_request_error".
 */
async function* errorStream(
  error: unknown,
  model: unknown,
  provider: Provider | null = null,
): AsyncGenerator<ChatCompletionChunk> {
  const chunk = makeErrorChunk(
    error,
    typeof model === "string" ? model : null,
    provider,
    errorType(error),
  );
  if (error instanceof RouterAPIError && chunk.error) {
    chunk.error.code = error.statusCode;
  }
  yield chunk;
}

/**
 * Restore placeholders in a streamed reply. A placeholder can be split across chunks, so an
 * unfinished "[..." at the end of a chunk is held back and joined to the next one.
 */
async function* restoreStream(
  chunks: AsyncIterable<ChatCompletionChunk>,
  vault: MaskVault,
): AsyncGenerator<ChatCompletionChunk> {
  let carry = "";
  let template: ChatCompletionChunk | null = null;

  for await (const chunk of chunks) {
    if (chunk.choices.length > 0) {
      template ??= chunk;
    }
    for (const choice of chunk.choices) {
      if (choice.delta.content !== null) {
        const [safe, held] = splitTrailingPartial(carry + choice.delta.content);
        carry = held;
        choice.delta.content = vault.restore(safe);
      }
    }
    yield chunk;
  }

  // Anything still held back goes out as one last text chunk.
  if (carry && template) {
    yield {
      ...template,
      usage: null,
      choices: [
        {
          index: template.choices[0]?.index ?? 0,
          delta: { role: null, content: vault.restore(carry) },
          finish_reason: null,
          provider_finish_reason: null,
        },
      ],
    };
  }
}

function errorType(error: unknown): string {
  if (error instanceof GuardrailsError || error instanceof ServerGuardrailsError) {
    return "guardrail_error";
  }
  return error instanceof RouterAPIError ? "api_error" : "invalid_request_error";
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

/** Settings a `Gateway` remembers. */
export interface GatewayOptions {
  /** Provider used when a call doesn't name one. */
  defaultProvider?: string;
  /** Provider API key used when a call doesn't pass one. */
  defaultApiKey?: string;
  /**
   * API key for the Rezunate LLM API (prompts and the hosted PII scan); defaults to the
   * `REZUNATE_LLM_API_KEY` env var.
   */
  rezunateLlmApiKey?: string;
  /** Guardrail rules checked on every call, unless a call passes its own. */
  guardrailsConfig?: GuardrailsConfig;
  /**
   * Scan with the hosted PII service: `true` scans input and output, a config picks the sides.
   * Off by default.
   */
  serverGuardrails?: boolean | ServerGuardrailsConfig;
}

/** Per-call options for `Gateway.chatComplete`; anything left out uses the gateway's defaults. */
export type GatewayChatOptions = Partial<Omit<ChatCompleteOptions, "request">> & {
  serverGuardrails?: boolean | ServerGuardrailsConfig;
  /**
   * Mask PII in the messages with restorable placeholders (from `redact` rules and the server
   * scan), and restore the reply. A new vault is used per call unless `vault` is passed.
   * Keep one vault per end-user; never share one across users.
   */
  reversible?: boolean;
  /** With `reversible`, restore the reply's placeholders (default true); false keeps it masked. */
  rehydrate?: boolean;
};

/** What a guarded call applies, besides the plain chat options. */
interface GuardedCall {
  scan: ReadonlySet<GuardrailDirection>;
  vault: MaskVault | undefined;
  rehydrate: boolean;
}

/** Hosted PII detection, available as `gateway.guardrails`. */
export interface GuardrailsResource {
  /** Scan a text with the workspace's guardrail settings. Throws `RouterAPIError` on failure. */
  scan(text: string): Promise<ScanResponse>;
}

const BOTH_DIRECTIONS = [GuardrailDirection.INPUT, GuardrailDirection.OUTPUT] as const;

/**
 * One object that remembers your settings: the default provider and its key for chat, the
 * Rezunate LLM API key for prompts and the hosted PII scan, and the guardrails to apply.
 */
export class Gateway {
  readonly defaultProvider: string | null;
  readonly defaultApiKey: string | null;
  readonly guardrailsConfig: GuardrailsConfig | null;
  readonly serverGuardrails: boolean | ServerGuardrailsConfig;
  readonly guardrails: GuardrailsResource;
  private readonly rezunateLlmApiKey: string | null;
  private cachedClient: RouterClient | null = null;

  constructor(options: GatewayOptions = {}) {
    this.defaultProvider = options.defaultProvider ?? null;
    this.defaultApiKey = options.defaultApiKey ?? null;
    this.guardrailsConfig = options.guardrailsConfig ?? null;
    this.serverGuardrails = options.serverGuardrails ?? false;
    this.rezunateLlmApiKey = options.rezunateLlmApiKey ?? null;
    this.guardrails = { scan: (text) => scanText(this.client, text) };
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
   * With server guardrails on, messages and/or the reply are scanned by the hosted PII service.
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
    const { serverGuardrails, reversible = false, rehydrate = true, ...callOptions } = options;
    const provider = callOptions.provider || this.defaultProvider;
    const apiKey = callOptions.apiKey || this.defaultApiKey;
    if (!provider || !apiKey) {
      const error = new Error(
        provider ? "API key must be specified" : "Provider must be specified",
      );
      return request?.stream === true ? errorStream(error, request.model) : Promise.reject(error);
    }

    // A vault only for reversible calls, local to the call, so end-users never share masks.
    const vault = reversible ? (callOptions.vault ?? new MaskVault()) : undefined;
    const chatOptions: ChatCompleteOptions = {
      ...callOptions,
      provider,
      apiKey,
      request,
      guardrailsConfig: callOptions.guardrailsConfig ?? this.guardrailsConfig ?? undefined,
      vault,
    };
    const call: GuardedCall = {
      scan: this.serverScanDirections(serverGuardrails),
      vault,
      rehydrate,
    };
    return request?.stream === true
      ? this.streamGuarded(chatOptions, call)
      : this.completeGuarded(chatOptions, call);
  }

  private async completeGuarded(
    options: ChatCompleteOptions,
    call: GuardedCall,
  ): Promise<ChatCompletionResponse> {
    if (call.scan.has(GuardrailDirection.INPUT)) {
      await this.scanMessages(options.request, call.vault);
    }
    const response = await complete(options);
    if (call.scan.has(GuardrailDirection.OUTPUT)) {
      for (const choice of response.choices) {
        if (choice.message.content) {
          choice.message.content = await this.serverScan(
            choice.message.content,
            GuardrailDirection.OUTPUT,
          );
        }
      }
    }
    // Restored last, after the output checks: placeholders pass them, and the restored PII
    // isn't scanned again.
    if (call.vault && call.rehydrate) {
      for (const choice of response.choices) {
        if (choice.message.content) {
          choice.message.content = call.vault.restore(choice.message.content);
        }
      }
    }
    return response;
  }

  private async *streamGuarded(
    options: ChatCompleteOptions,
    call: GuardedCall,
  ): AsyncGenerator<ChatCompletionChunk> {
    if (call.scan.has(GuardrailDirection.INPUT)) {
      try {
        await this.scanMessages(options.request, call.vault);
      } catch (error) {
        yield* errorStream(error, options.request.model);
        return;
      }
    }
    const chunks = streamChat(options);
    yield* call.vault && call.rehydrate ? restoreStream(chunks, call.vault) : chunks;
  }

  /** The sides to scan on a call: `true` means both, a config picks them, off means none. */
  private serverScanDirections(
    callSetting: boolean | ServerGuardrailsConfig | undefined,
  ): ReadonlySet<GuardrailDirection> {
    const setting = callSetting ?? this.serverGuardrails;
    if (!setting) {
      return new Set();
    }
    return new Set(setting === true ? BOTH_DIRECTIONS : (setting.directions ?? BOTH_DIRECTIONS));
  }

  /**
   * Scan every message before it's sent; the result is written into it.
   * With a vault, detected PII is masked with restorable placeholders instead.
   */
  private async scanMessages(request: ChatCompletionRequest, vault?: MaskVault): Promise<void> {
    for (const message of request.messages) {
      if (message.content) {
        message.content = vault
          ? await this.serverScanReversible(message.content, vault)
          : await this.serverScan(message.content, GuardrailDirection.INPUT);
      }
    }
  }

  /** Scan an input text and mask each detected span with its own placeholder in `vault`. */
  private async serverScanReversible(text: string, vault: MaskVault): Promise<string> {
    const result = await this.guardrails.scan(text);
    if (result.blocked) {
      throw new ServerGuardrailsError(GuardrailDirection.INPUT, result.entities, result.action);
    }
    return result.entities.length > 0 ? vault.maskEntities(text, result.entities) : text;
  }

  /** Scan one text with the hosted service: throws if it's blocked, else returns the result. */
  private async serverScan(text: string, direction: GuardrailDirection): Promise<string> {
    const result = await this.guardrails.scan(text);
    if (result.blocked) {
      throw new ServerGuardrailsError(direction, result.entities, result.action);
    }
    return result.text && result.text !== text ? result.text : text;
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
