/** Checks the public API exported from the package entry point (Python `__init__.py`). */

import { describe, expect, it } from "vitest";
import * as sdk from "../src/rezunateLlmSdk/index";

describe("package entry point", () => {
  it("exports the public API ported so far", () => {
    expect(Object.keys(sdk).sort()).toEqual(
      [
        "AnthropicProvider",
        "BaseProvider",
        "ChatCompletionChunkSchema",
        "ChatCompletionRequestSchema",
        "ChatCompletionResponseSchema",
        "ChoiceChunkSchema",
        "ChoiceDeltaSchema",
        "DeepSeekProvider",
        "Gateway",
        "GoogleProvider",
        "GuardrailAction",
        "GuardrailDirection",
        "GuardrailRuleSchema",
        "GuardrailsConfigSchema",
        "GuardrailsError",
        "GrokProvider",
        "MetaProvider",
        "FunctionCallSchema",
        "FunctionDefinitionSchema",
        "MessageSchema",
        "PromptResponseSchema",
        "RouterAPIError",
        "RouterClient",
        "ToolCallDeltaSchema",
        "ToolCallSchema",
        "ToolChoiceFunctionSchema",
        "ToolChoiceOptionSchema",
        "ToolSchema",
        "OpenAIProvider",
        "QwenProvider",
        "chatComplete",
        "checkGuardrails",
        "getAvailableProviders",
        "getPrompt",
        "getProvider",
        "listProviders",
        "loadGuardrails",
        "renderPrompt",
      ].sort(),
    );
  });
});
