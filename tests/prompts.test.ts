/**
 * Tests for renderPrompt.
 * New in the TS port: the Python SDK has no tests for `prompts.py`.
 */

import { describe, expect, it } from "vitest";
import { renderPrompt } from "../src/rezunateLlmSdk/prompts";

describe("renderPrompt", () => {
  it("replaces every placeholder, including repeated ones", () => {
    const text = renderPrompt("Hi {{name}}, welcome to {{company}}. Bye {{name}}!", {
      name: "Ali",
      company: "Acme",
    });

    expect(text).toBe("Hi Ali, welcome to Acme. Bye Ali!");
  });

  it("throws listing every missing variable in order", () => {
    expect(() => renderPrompt("{{tone}} {{company}} {{name}}", { name: "Ali" })).toThrow(
      "Missing template variables: company, tone",
    );
  });

  it("ignores extra values and works without variables", () => {
    expect(renderPrompt("Hello {{name}}", { name: "Ali", unused: "x" })).toBe("Hello Ali");
    expect(renderPrompt("No placeholders here")).toBe("No placeholders here");
  });

  it("treats an undefined value as missing instead of leaving the placeholder", () => {
    const variables = { name: "Ali", tone: undefined } as unknown as Record<string, string>;

    expect(() => renderPrompt("Hi {{name}} in a {{tone}} tone", variables)).toThrow(
      "Missing template variables: tone",
    );
  });

  it("does not treat built-in object names as provided", () => {
    expect(() => renderPrompt("{{constructor}} {{toString}}", {})).toThrow(
      "Missing template variables: constructor, toString",
    );
  });

  it("leaves text that is not a valid placeholder unchanged", () => {
    expect(renderPrompt("{{ name }} {{1st}} {name}", {})).toBe("{{ name }} {{1st}} {name}");
  });
});
