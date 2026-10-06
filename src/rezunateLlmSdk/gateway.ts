/** Gateway - routes chat completion requests to providers. */

import {
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
} from "./models";
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
    const model = options.request?.model;
    yield makeErrorChunk(error, typeof model === "string" ? model : null);
    return;
  }
  yield* providerInstance.stream(request);
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
