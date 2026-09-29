import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import * as constants from "../constants";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../models";
import { ChatCompletionResponseSchema } from "../models";
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
      maxRetries: this.maxRetries,
    });
    return this.cachedClient;
  }

  /** Default Bearer-token auth. Override if a provider uses something else. */
  getHeaders(): Record<string, string> {
    return {
      [constants.AUTHORIZATION_HEADER]: `Bearer ${this.apiKey}`,
      [constants.CONTENT_TYPE_HEADER]: constants.APPLICATION_JSON,
    };
  }

  getEndpoint(): string {
    return OPENAI_CHAT_ENDPOINT;
  }

  /** Pass-through — request is already in OpenAI format. */
  transformRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    return request;
  }

  protected override async executeRequest(providerRequest: unknown): Promise<unknown> {
    // Our request model is looser than the SDK's param types (extra fields are allowed and
    // passed through, as in Python), so it is handed over as the SDK's param type.
    const params = dropNones(providerRequest) as ChatCompletionCreateParamsNonStreaming;
    return await this.client.chat.completions.create(params, { timeout: this.timeout * 1000 });
  }

  /**
   * Convert the SDK response to our internal model.
   *
   * Providers that need to normalize quirky finish_reason values
   * (e.g. DeepSeek) override this with a small pre-validation step.
   */
  transformResponse(response: unknown): ChatCompletionResponse {
    return ChatCompletionResponseSchema.parse(response);
  }
}
