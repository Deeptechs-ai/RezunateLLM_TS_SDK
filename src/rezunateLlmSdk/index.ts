/**
 * Rezunate LLM SDK.
 * A unified TypeScript library for chat completions across multiple AI providers,
 * using the OpenAI-compatible request/response format.
 */

export { getPrompt } from "./api";
export {
  RouterAPIError,
  RouterClient,
  type RouterClientOptions,
  type RouterRequestOptions,
} from "./client";
export {
  type ChatCompleteOptions,
  chatComplete,
  Gateway,
  type GatewayChatOptions,
  type GatewayOptions,
  getAvailableProviders,
} from "./gateway";
export { checkGuardrails, GuardrailsError, loadGuardrails } from "./guardrails";
export {
  type ChatCompletionChunk,
  ChatCompletionChunkSchema,
  type ChatCompletionRequest,
  ChatCompletionRequestSchema,
  type ChatCompletionResponse,
  ChatCompletionResponseSchema,
  type ChoiceChunk,
  ChoiceChunkSchema,
  type ChoiceDelta,
  ChoiceDeltaSchema,
  type FunctionCall,
  FunctionCallSchema,
  type FunctionDefinition,
  FunctionDefinitionSchema,
  GuardrailAction,
  GuardrailDirection,
  type GuardrailRule,
  GuardrailRuleSchema,
  type GuardrailsConfig,
  GuardrailsConfigSchema,
  type GuardrailViolation,
  type Message,
  MessageSchema,
  type PromptResponse,
  PromptResponseSchema,
  type Tool,
  type ToolCall,
  type ToolCallDelta,
  ToolCallDeltaSchema,
  ToolCallSchema,
  type ToolChoiceFunction,
  ToolChoiceFunctionSchema,
  type ToolChoiceOption,
  ToolChoiceOptionSchema,
  ToolSchema,
} from "./models";
export { renderPrompt } from "./prompts";
export {
  AnthropicProvider,
  BaseProvider,
  DeepSeekProvider,
  GoogleProvider,
  GrokProvider,
  getProvider,
  listProviders,
  MetaProvider,
  OpenAIProvider,
  QwenProvider,
} from "./providers";
