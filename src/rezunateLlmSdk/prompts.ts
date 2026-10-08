/** Standalone template rendering utility. */

/** Matches `{{variable}}` placeholders; the name starts with a letter or underscore. */
const TEMPLATE_VARIABLE = /\{\{([a-zA-Z_]\w*)\}\}/g;

/**
 * Replace `{{variable}}` placeholders in a prompt template.
 * Throws if the template uses a variable that `variables` doesn't provide; extra values are ignored.
 */
export function renderPrompt(
  content: string,
  variables: Readonly<Record<string, string>> | null = null,
): string {
  const values = variables ?? {};

  const missing = new Set<string>();
  for (const [, name] of content.matchAll(TEMPLATE_VARIABLE)) {
    // Object.hasOwn, so built-in names such as "constructor" never count as provided.
    if (name && !Object.hasOwn(values, name)) {
      missing.add(name);
    }
  }
  if (missing.size > 0) {
    throw new Error(`Missing template variables: ${[...missing].sort().join(", ")}`);
  }

  return content.replace(TEMPLATE_VARIABLE, (match, name: string) => values[name] ?? match);
}
