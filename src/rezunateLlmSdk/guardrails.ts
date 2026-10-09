/** Guardrails: regex-based content filtering for inputs and outputs. */

import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  GuardrailAction,
  type GuardrailDirection,
  type GuardrailsConfig,
  GuardrailsConfigSchema,
  type GuardrailViolation,
} from "./models";

/** Raised when content matches a guardrail rule whose action is `block`. */
export class GuardrailsError extends Error {
  readonly ruleName: string;
  readonly ruleDescription: string;
  readonly direction: GuardrailDirection;

  constructor(ruleName: string, ruleDescription: string, direction: GuardrailDirection) {
    super(`Guardrail '${ruleName}' triggered on ${direction.toUpperCase()}: ${ruleDescription}`);
    this.name = "GuardrailsError";
    this.ruleName = ruleName;
    this.ruleDescription = ruleDescription;
    this.direction = direction;
  }
}

/**
 * Load a guardrails configuration from a YAML file.
 * Throws if the file is missing, has no `guardrails` key, or a pattern isn't a valid
 * JavaScript regular expression.
 */
export function loadGuardrails(configPath: string): GuardrailsConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Guardrails config not found: ${configPath}`);
  }

  const data: unknown = parseYaml(readFileSync(configPath, "utf8"));
  if (data === null || typeof data !== "object" || !("guardrails" in data)) {
    throw new Error("Guardrails config must contain a 'guardrails' key");
  }

  const config = GuardrailsConfigSchema.parse(data);

  // Compile every pattern now, so an invalid one fails at load time, not on a request.
  for (const rule of config.guardrails) {
    try {
      new RegExp(rule.pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid regex in rule '${rule.name}': ${reason}`, { cause: error });
    }
  }

  return config;
}

/**
 * Check a text against every rule, in order, and apply redactions.
 * `block` rules throw `GuardrailsError`, `flag` rules only record a violation, and `redact`
 * rules replace every match with the rule's `replacement`.
 * Returns `[redactedText, violations]`; `redactedText` equals `text` when nothing was redacted.
 */
export function checkGuardrails(
  text: string,
  config: GuardrailsConfig,
  direction: GuardrailDirection,
): [string, GuardrailViolation[]] {
  const violations: GuardrailViolation[] = [];
  let redacted = text;

  for (const rule of config.guardrails) {
    // Matches are found in the original text, as in the Python SDK.
    const match = new RegExp(rule.pattern).exec(text);
    if (!match) {
      continue;
    }

    violations.push({
      ruleName: rule.name,
      ruleDescription: rule.description,
      direction,
      action: rule.action,
      match: match[0],
    });

    if (rule.action === GuardrailAction.BLOCK) {
      throw new GuardrailsError(rule.name, rule.description, direction);
    }

    if (rule.action === GuardrailAction.REDACT) {
      // A function, so "$&" or "$1" in the replacement is inserted as written.
      redacted = redacted.replace(new RegExp(rule.pattern, "g"), () => rule.replacement);
    }
  }

  return [redacted, violations];
}
