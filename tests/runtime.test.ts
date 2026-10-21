/** Tests for the Node.js version check (new in the TS port; pip enforces Python's version). */

import { describe, expect, it } from "vitest";
import { assertSupportedNode } from "../src/rezunateLlmSdk/runtime";

describe("assertSupportedNode", () => {
  it.each(["22.0.0", "22.14.0", "24.1.0"])("accepts Node.js %s", (version) => {
    expect(() => assertSupportedNode(version)).not.toThrow();
  });

  it("rejects an older Node.js with a clear message", () => {
    expect(() => assertSupportedNode("20.11.1")).toThrow(
      "@rezunatellm/llm-sdk requires Node.js 22 or newer (you have 20.11.1).",
    );
  });

  it("skips the check where there is no Node.js version", () => {
    expect(() => assertSupportedNode(undefined)).not.toThrow();
  });
});
