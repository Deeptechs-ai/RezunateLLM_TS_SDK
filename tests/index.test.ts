/** Checks the public API exported from the package entry point (Python `__init__.py`). */

import { describe, expect, it } from "vitest";
import * as sdk from "../src/index";

describe("package entry point", () => {
  it("exports the Feature 1 public API", () => {
    expect(Object.keys(sdk).sort()).toEqual(
      [
        "BaseProvider",
        "ChatCompletionRequestSchema",
        "ChatCompletionResponseSchema",
        "MessageSchema",
        "OpenAIProvider",
        "chatComplete",
        "getAvailableProviders",
        "getProvider",
        "listProviders",
      ].sort(),
    );
  });
});
