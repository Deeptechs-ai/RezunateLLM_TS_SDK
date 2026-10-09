/**
 * Tests for regex guardrails, ported from the Python `tests/guardrails/test_guardrails.py`.
 * Added in the TS port: loadGuardrails (the Python file has no load tests).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkGuardrails, GuardrailsError, loadGuardrails } from "../src/rezunateLlmSdk/guardrails";
import {
  type GuardrailRule,
  type GuardrailsConfig,
  GuardrailsConfigSchema,
} from "../src/rezunateLlmSdk/models";

const SSN_PATTERN = String.raw`\b\d{3}-\d{2}-\d{4}\b`;
const EMAIL_PATTERN = String.raw`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`;

/** A config from rules given in the YAML shape (defaults are filled in). */
function config(...rules: Partial<GuardrailRule>[]): GuardrailsConfig {
  return GuardrailsConfigSchema.parse({ guardrails: rules });
}

describe("checkGuardrails: redact", () => {
  it("redacts a match with the default replacement", () => {
    const [redacted, violations] = checkGuardrails(
      "My SSN is 123-45-6789.",
      config({ name: "redact-ssn", pattern: SSN_PATTERN, action: "redact" }),
      "output",
    );

    expect(redacted).toBe("My SSN is [REDACTED].");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ action: "redact", match: "123-45-6789" });
  });

  it("redacts with a custom replacement", () => {
    const [redacted] = checkGuardrails(
      "Reach me at alex@example.com please.",
      config({
        name: "redact-email",
        pattern: EMAIL_PATTERN,
        action: "redact",
        replacement: "[EMAIL]",
      }),
      "output",
    );

    expect(redacted).toBe("Reach me at [EMAIL] please.");
  });

  it("redacts every occurrence", () => {
    const [redacted] = checkGuardrails(
      "111-22-3333 and 444-55-6666",
      config({ name: "redact-ssn", pattern: SSN_PATTERN, action: "redact" }),
      "output",
    );

    expect(redacted).toBe("[REDACTED] and [REDACTED]");
  });

  it("applies several redact rules together", () => {
    const [redacted, violations] = checkGuardrails(
      "ssn 123-45-6789 email a@b.com",
      config(
        { name: "redact-ssn", pattern: SSN_PATTERN, action: "redact", replacement: "[SSN]" },
        { name: "redact-email", pattern: EMAIL_PATTERN, action: "redact", replacement: "[EMAIL]" },
      ),
      "output",
    );

    expect(redacted).toBe("ssn [SSN] email [EMAIL]");
    expect(violations).toHaveLength(2);
  });

  it("returns the text unchanged when nothing matches", () => {
    const text = "Nothing sensitive here.";

    const [redacted, violations] = checkGuardrails(
      text,
      config({ name: "redact-ssn", pattern: SSN_PATTERN, action: "redact" }),
      "output",
    );

    expect(redacted).toBe(text);
    expect(violations).toEqual([]);
  });
});

describe("checkGuardrails: block and flag", () => {
  it("throws GuardrailsError for a block rule", () => {
    const check = () =>
      checkGuardrails(
        "SSN 123-45-6789",
        config({ name: "block-ssn", pattern: SSN_PATTERN, action: "block" }),
        "output",
      );

    expect(check).toThrow(GuardrailsError);
    expect(check).toThrow(expect.objectContaining({ ruleName: "block-ssn", direction: "output" }));
  });

  it("records a flag violation without changing the text", () => {
    const text = "SSN 123-45-6789";

    const [redacted, violations] = checkGuardrails(
      text,
      config({ name: "flag-ssn", pattern: SSN_PATTERN, action: "flag" }),
      "output",
    );

    expect(redacted).toBe(text);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.action).toBe("flag");
  });
});

describe("checkGuardrails: return value", () => {
  it("returns the text and the violations", () => {
    const result = checkGuardrails(
      "SSN 123-45-6789",
      config({ name: "flag-ssn", pattern: SSN_PATTERN, action: "flag" }),
      "input",
    );

    expect(result).toEqual([
      "SSN 123-45-6789",
      [
        {
          ruleName: "flag-ssn",
          ruleDescription: "",
          direction: "input",
          action: "flag",
          match: "123-45-6789",
        },
      ],
    ]);
  });
});

describe("loadGuardrails", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  /** Write a YAML file to a temporary folder and return its path. */
  function yamlFile(content: string): string {
    dir = mkdtempSync(join(tmpdir(), "guardrails-"));
    const path = join(dir, "guardrails.yaml");
    writeFileSync(path, content);
    return path;
  }

  it("loads rules and fills in the defaults", () => {
    const path = yamlFile(
      [
        "guardrails:",
        "  - name: block-ssn",
        String.raw`    pattern: '\b\d{3}-\d{2}-\d{4}\b'`,
        "  - name: redact-email",
        "    pattern: '@'",
        "    action: redact",
        "    replacement: '[EMAIL]'",
      ].join("\n"),
    );

    expect(loadGuardrails(path).guardrails).toEqual([
      {
        name: "block-ssn",
        pattern: SSN_PATTERN,
        description: "",
        action: "block",
        replacement: "[REDACTED]",
      },
      {
        name: "redact-email",
        pattern: "@",
        description: "",
        action: "redact",
        replacement: "[EMAIL]",
      },
    ]);
  });

  it("throws when the file does not exist", () => {
    expect(() => loadGuardrails("/no/such/guardrails.yaml")).toThrow(
      "Guardrails config not found: /no/such/guardrails.yaml",
    );
  });

  it("throws when the guardrails key is missing", () => {
    expect(() => loadGuardrails(yamlFile("rules: []"))).toThrow(
      "Guardrails config must contain a 'guardrails' key",
    );
  });

  it("throws for an invalid regex, naming the rule", () => {
    const path = yamlFile("guardrails:\n  - name: broken\n    pattern: '[a-z'");

    expect(() => loadGuardrails(path)).toThrow("Invalid regex in rule 'broken':");
  });
});
