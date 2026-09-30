/** Checks the public API exported from the package entry point (Python `__init__.py`). */

import { describe, expect, it } from "vitest";
import * as sdk from "../src/index";

describe("package entry point", () => {
  it("exports the public API ported so far", () => {
    expect(Object.keys(sdk).sort()).toEqual(
      [
        "AnthropicProvider",
        "BaseProvider",
        "ChatCompletionRequestSchema",
        "ChatCompletionResponseSchema",
        "DeepSeekProvider",
        "GoogleProvider",
        "GrokProvider",
        "LlamaProvider",
        "MessageSchema",
        "OpenAIProvider",
        "QwenProvider",
        "chatComplete",
        "getAvailableProviders",
        "getProvider",
        "listProviders",
      ].sort(),
    );
  });
});
