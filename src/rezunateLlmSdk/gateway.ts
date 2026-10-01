/** Gateway - routes chat completion requests to providers. */

import {
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
} from "./models";
import { getProvider, listProviders } from "./providers";

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
 * The request is validated first; provider errors come back in `response.error`.
 */
export async function chatComplete(options: ChatCompleteOptions): Promise<ChatCompletionResponse> {
  const request = ChatCompletionRequestSchema.parse(options.request);

  if (request.stream) {
    throw new Error("Streaming is not supported yet");
  }

  const providerInstance = getProvider(options.provider, options.apiKey, {
    model: request.model,
    organization: options.organization,
    project: options.project,
    workspaceId: options.workspaceId,
  });
  return providerInstance.chatComplete(request);
}

/** Get the list of available provider names. */
export function getAvailableProviders(): string[] {
  return listProviders();
}
