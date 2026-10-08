import OpenAI, { type ClientOptions } from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import * as constants from "../constants";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../models";
import { ChatCompletionResponseSchema, mapFinishReason } from "../models";
import { BaseProvider, dropNones } from "./base";
import { OPENAI_CHAT_ENDPOINT } from "./endpoints";

/**
 * Provider base class for OpenAI-compatible REST APIs.
 *
 * All Chat Completions traffic flows through the official `openai` SDK
 * with a custom `baseURL`.
 */
export abstract class OpenAICompatibleProvider extends BaseProvider {
  private cachedClient: OpenAI | null = null;

  /**
   * The OpenAI SDK client, created on first use. (Python builds it in `__init__`; a TS
   * constructor cannot read `baseUrl`, which each subclass defines.)
   */
  get client(): OpenAI {
    this.cachedClient ??= new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
      // Retries are handled by the shared loop in BaseProvider, the same for every provider.
      maxRetries: 0,
      ...this.extraClientOptions(),
    });
    return this.cachedClient;
  }

  /**
   * Extra options for the OpenAI SDK client. None by default, so OpenAI-only settings
   * (organization, project) are never sent to other providers; OpenAI overrides this.
   */
  protected extraClientOptions(): Partial<ClientOptions> {
    return {};
  }

  /** Default Bearer-token auth. Override if a provider uses something else. */
  getHeaders(): Record<string, string> {
    return {
      [constants.AUTHORIZATION_HEADER]: `Bearer ${this.apiKey}`,
      [constants.CONTENT_TYPE_HEADER]: constants.APPLICATION_JSON,
    };
  }

  /** Chat endpoint path; providers override it when theirs differs. */
  get chatEndpoint(): string {
    return OPENAI_CHAT_ENDPOINT;
  }

  getEndpoint(): string {
    return this.chatEndpoint;
  }

  /** Pass-through — request is already in OpenAI format. */
  transformRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    return request;
  }

  /** Send the request once through the OpenAI SDK; retries come from the shared loop. */
  protected override async sendRequest(providerRequest: unknown): Promise<unknown> {
    // Our request model is looser than the SDK's param types (extra fields are allowed and
    // passed through, as in Python), so it is handed over as the SDK's param type.
    const params = dropNones(providerRequest) as ChatCompletionCreateParamsNonStreaming;
    return await this.client.chat.completions.create(params, { timeout: this.timeout * 1000 });
  }

  /**
   * Convert the SDK response to our internal model.
   * Each finish_reason is translated first (e.g. DeepSeek's `insufficient_system_resource`,
   * or a value we don't know yet), and the original is kept in `provider_finish_reason`.
   */
  transformResponse(response: unknown): ChatCompletionResponse {
    if (response === null || typeof response !== "object") {
      return ChatCompletionResponseSchema.parse(response);
    }

    const data = { ...(response as Record<string, unknown>) };
    if (Array.isArray(data.choices)) {
      data.choices = data.choices.map((choice: unknown) => {
        if (choice === null || typeof choice !== "object") {
          return choice;
        }
        const reason = (choice as { finish_reason?: unknown }).finish_reason;
        return typeof reason === "string"
          ? { ...choice, finish_reason: mapFinishReason(reason), provider_finish_reason: reason }
          : choice;
      });
    }
    return ChatCompletionResponseSchema.parse(data);
  }
}
