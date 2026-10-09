/** Guardrails: regex-based content filtering for inputs and outputs. */

import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import * as constants from "./constants";
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

/**
 * Check a text, print a warning for every violation, and return the redacted text.
 * Used for inputs, outputs and stream chunks. `block` rules still throw `GuardrailsError`.
 */
export function applyGuardrails(
  text: string,
  config: GuardrailsConfig,
  direction: GuardrailDirection,
): string {
  const [redacted, violations] = checkGuardrails(text, config, direction);
  for (const violation of violations) {
    console.warn(formatViolation(violation));
  }
  return redacted;
}

/** The warning for a violation, in the Python SDK's format (including the matched text). */
function formatViolation(violation: GuardrailViolation): string {
  const { action, direction, ruleName, ruleDescription, match } = violation;
  return (
    `GUARDRAIL ${action.toUpperCase()} [${direction.toUpperCase()}]: ` +
    `rule_name='${ruleName}' rule_description='${ruleDescription}' match='${match}'`
  );
}

/** Cache for `automaticGuardrails`: undefined until the file has been looked at once. */
let automaticConfig: GuardrailsConfig | null | undefined;

/**
 * The guardrails file named by the `GUARDRAILS_FILE_PATH` env var, loaded once.
 * Null when the variable is unset or the file is missing; an invalid file prints a warning.
 */
export function automaticGuardrails(): GuardrailsConfig | null {
  if (automaticConfig === undefined) {
    automaticConfig = loadAutomaticGuardrails();
  }
  return automaticConfig;
}

function loadAutomaticGuardrails(): GuardrailsConfig | null {
  const path = process.env[constants.GUARDRAILS_FILE_PATH_ENV];
  if (!path || !existsSync(path)) {
    return null;
  }
  try {
    return loadGuardrails(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to load automatic guardrails from ${path}: ${reason}`);
    return null;
  }
}
