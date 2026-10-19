/** Names and paths shared by more than one module. */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  REZUNATE_LLM_API_KEY_ENV,
  REZUNATE_LLM_BASE_URL_ENV,
  REZUNATE_LLM_DEFAULT_BASE_URL,
} from "../rezunateLlmSdk/constants";

export const CONFIG_FILENAME = ".rezunate-guard.yaml";

export const HOME_ENV = "REZUNATE_HOME";
export const API_KEY_ENV = REZUNATE_LLM_API_KEY_ENV;
export const BASE_URL_ENV = REZUNATE_LLM_BASE_URL_ENV;
export const DEFAULT_BASE_URL = REZUNATE_LLM_DEFAULT_BASE_URL;
export const API_KEYS_PATH = "/dashboard/apikeys";
export const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";

// Problem log
/** Lines kept. Older ones are dropped, since only a current problem can be acted on. */
export const LOG_MAX_LINES = 200;
/** How far back to look before repeating ourselves. The hook runs once per tool call. */
export const LOG_RECENT_LINES = 20;
/** Enough of a problem to act on. A YAML error can run to several lines. */
export const LOG_MAX_MESSAGE = 120;

/** The page where a user creates an API key. */
export function apiKeysUrl(): string {
  const base = (process.env[BASE_URL_ENV] || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}${API_KEYS_PATH}`;
}

/**
 * The directory holding our own state: `$REZUNATE_HOME`, or `~/.rezunate` if it is unset.
 * Read on every call, so a test run can point it away from the real home directory.
 */
export function rezunateHome(): string {
  return process.env[HOME_ENV] || join(homedir(), ".rezunate");
}

/** The file holding the saved API key. */
export function credentialsPath(): string {
  return join(rezunateHome(), "credentials");
}

/** The file holding the placeholder key. */
export function placeholderKeyPath(): string {
  return join(rezunateHome(), "placeholder.key");
}

/** The file holding problems worth telling the user about. */
export function logPath(): string {
  return join(rezunateHome(), "guard.log");
}

/**
 * The directory holding redacted copies for unreadable files. Deliberately outside any
 * project, so a copy is never itself protected and the hook never redacts its own output.
 */
export function redactedCopiesDir(): string {
  return join(rezunateHome(), "redacted-copies");
}
