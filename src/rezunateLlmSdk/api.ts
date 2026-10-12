/** Rezunate LLM API endpoints. */

import type { RouterClient } from "./client";
import * as constants from "./constants";
import {
  type PromptResponse,
  PromptResponseSchema,
  type ScanResponse,
  ScanResponseSchema,
} from "./models";

/**
 * Fetch a prompt by its slug from the Rezunate LLM API.
 * Without `version`, the prompt's current version is returned. Throws `RouterAPIError` on failure.
 */
export async function getPrompt(
  client: RouterClient,
  slugId: string,
  version?: number | null,
): Promise<PromptResponse> {
  // Encoded so a slug can't change the request path.
  const path = `${constants.PROMPT_ENDPOINT}/${encodeURIComponent(slugId)}`;
  const response = await client.request("GET", path, { params: { version: version ?? undefined } });
  return PromptResponseSchema.parse(await response.json());
}

/**
 * Scan a text for PII with the hosted guardrail service, using the workspace's settings.
 * Throws `RouterAPIError` on failure.
 */
export async function scanText(client: RouterClient, text: string): Promise<ScanResponse> {
  const response = await client.request("POST", constants.GUARDRAILS_SCAN_ENDPOINT, {
    json: { text },
    timeout: constants.GUARDRAILS_SCAN_TIMEOUT,
  });
  return ScanResponseSchema.parse(await response.json());
}
