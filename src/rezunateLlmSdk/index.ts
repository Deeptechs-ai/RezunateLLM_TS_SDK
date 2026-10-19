/**
 * Rezunate LLM SDK.
 * A unified TypeScript library for chat completions across multiple AI providers,
 * using the OpenAI-compatible request/response format.
 */

import { assertSupportedNode } from "./runtime";

// An unsupported Node.js version fails here with a clear message. A call in the entry file,
// so the build keeps it (`"sideEffects": false` lets it drop a side-effect-only import).
assertSupportedNode(globalThis.process?.versions?.node);

export { getPrompt, scanText } from "./api";
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
  type GuardrailsResource,
  getAvailableProviders,
} from "./gateway";
export {
  checkGuardrails,
  GuardrailsError,
  loadGuardrails,
  ServerGuardrailsError,
} from "./guardrails";
export { MaskingError, type MaskSpan, MaskVault, unmask } from "./masking";
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
  type DetectedEntity,
  DetectedEntitySchema,
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
  type ScanResponse,
  ScanResponseSchema,
  type ServerGuardrailsConfig,
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
