/**
 * Decide whether a file needs to be scanned.
 *
 * 1. Find the nearest config file for the given file.
 * 2. Load and parse the config and get the protected folders.
 * 3. Check whether the file is inside any protected folder; if it is, it should be scanned.
 * 4. If the file is outside the config's root, check whether it has its own config.
 * 5. Otherwise, the file does not need scanning.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from "node:path";
import { parse as parseYaml } from "yaml";
import * as constants from "./constants";
import { problem } from "./log";

/** Whether to scan a file, and why (for `status` and `check` to print). */
export interface Decision {
  shouldScan: boolean;
  reason: string;
}

/** A parsed config file. While `error` is set, nothing is protected. */
export class GuardConfig {
  constructor(
    /** The folder this config sits in. */
    readonly root: string,
    /** Protected folders, as absolute paths. */
    readonly scan: readonly string[] = [],
    /** The file this came from, if any. */
    readonly source: string | null = null,
    /** Why the config couldn't be read. */
    readonly error: string | null = null,
  ) {}

  /** True when no folder is listed: a guard that quietly does nothing is worse than none. */
  get protectsNothing(): boolean {
    return this.scan.length === 0;
  }
}

/**
 * The config used when one exists but can't be read: it scans nothing, and the error is
 * logged and shown by `status`, the only thing that tells the user they are unprotected.
 */
export function brokenConfig(root: string, source: string | null, error: string): GuardConfig {
  problem(source ?? root, error);
  return new GuardConfig(root, [], source, error);
}

/** Thrown for a config entry that can't be understood; its message is shown to the user. */
class ConfigError extends Error {}

/**
 * Turn one entry from `scan:` into an absolute folder. A relative name hangs off `root`;
 * an absolute or `~` name is taken as written, so a config can protect a folder outside its
 * project. A pattern, or a `~` that points nowhere, throws: either would name a folder that
 * never exists, leaving the user believing they were covered.
 */
function resolveFolder(name: string, root: string): string {
  const text = name.replace(/\/+$/, "") || "/";
  if ([..."*?["].some((character) => text.includes(character))) {
    throw new ConfigError(`${repr(name)} is not a folder; name the folder, such as 'clients'`);
  }

  let folder: string;
  try {
    folder = expandUser(text);
  } catch (error) {
    throw new ConfigError(`${repr(name)} is not a folder: ${(error as Error).message}`);
  }
  return resolvePath(isAbsolute(folder) ? folder : join(root, folder));
}

/** The folders listed under `scan:` (one folder name, or a list of them), resolved. */
function listedFolders(value: unknown, root: string): string[] {
  const entries = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];

  const folders: string[] = [];
  for (const entry of entries) {
    if (entry !== null && entry !== undefined && typeof entry !== "string") {
      throw new ConfigError(`${repr(entry)} is not a folder name; check the punctuation`);
    }
    const name = (entry ?? "").trim();
    if (name) {
      folders.push(resolveFolder(name, root));
    }
  }
  return folders;
}

/**
 * Walk up from the file being read (not the working directory) to the nearest config file.
 * Nearest wins, so one folder in a monorepo can protect itself more tightly than the repo.
 */
export function findConfigFile(start: string): string | null {
  let current = resolvePath(start);
  if (isFile(current)) {
    current = dirname(current);
  }

  for (;;) {
    const candidate = join(current, constants.CONFIG_FILENAME);
    if (isFile(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Configs already parsed, keyed by the file and its contents. Reading is cheap, parsing is
 * not, and keying on the text cannot serve a stale answer the way a timestamp can.
 */
const parsed = new Map<string, GuardConfig>();

/**
 * Parse a config file, reusing the last parse of the same contents (one tool call asks about
 * every path it touched, and they usually share a config). Never throws: anything it can't
 * read comes back as a `brokenConfig`, which protects nothing and logs why.
 */
export function loadConfig(configPath: string): GuardConfig {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    return brokenConfig(
      dirname(configPath),
      configPath,
      `could not read config: ${(error as Error).message}`,
    );
  }

  const key = `${configPath}\0${text}`;
  let config = parsed.get(key);
  if (!config) {
    config = parseConfig(configPath, text);
    parsed.set(key, config);
  }
  return config;
}

/** Read the `scan:` list out of a config file's text; throws if it can't be understood. */
function parseScanList(text: string, root: string): string[] {
  let raw: unknown;
  try {
    // PyYAML keeps the last of repeated keys rather than failing.
    raw = parseYaml(text, { uniqueKeys: false });
  } catch (error) {
    throw new ConfigError(`could not read config: ${(error as Error).message}`);
  }
  if (isEmpty(raw)) {
    raw = {};
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("config root must be a mapping");
  }

  const unknown = Object.keys(raw)
    .filter((key) => key !== "scan")
    .sort();
  if (unknown.length > 0) {
    throw new ConfigError(`unknown setting ${repr(unknown[0])}; expected \`scan:\``);
  }

  return listedFolders((raw as Record<string, unknown>).scan, root);
}

/** Turn the contents of one config file into rules. See `loadConfig`, which caches this. */
function parseConfig(configPath: string, text: string): GuardConfig {
  const root = dirname(configPath);

  let scan: string[];
  try {
    scan = parseScanList(text, root);
  } catch (error) {
    if (error instanceof ConfigError || isSystemError(error)) {
      return brokenConfig(root, configPath, error.message);
    }
    throw error;
  }

  if (scan.length === 0) {
    problem(configPath, "no folders listed under `scan:`");
  }

  // A folder that isn't there is how a mis-indented list shows up: the YAML parses, and the
  // entry quietly matches nothing.
  for (const directory of scan) {
    if (!isDirectory(directory)) {
      problem(configPath, `folder not found: ${directory}`);
    }
  }

  return new GuardConfig(root, scan, configPath);
}

/** Find and load the config that governs a path. Protects nothing if there is none. */
export function resolveConfig(filePath: string): GuardConfig {
  const configFile = findConfigFile(filePath);
  if (configFile === null) {
    return new GuardConfig(parsePath(resolvePath(filePath)).root || "/");
  }
  return loadConfig(configFile);
}

/**
 * Decide whether a file needs scanning. Nothing is scanned until the user lists a folder,
 * since every scan is billable. The answer comes from the file's own path, never the working
 * directory, because `claude --add-dir` reaches files belonging to another project.
 * Without `config`, the one governing the file is used.
 */
export function scanDecision(filePath: string, config?: GuardConfig): Decision {
  const path = resolvePath(filePath);
  const rules = config ?? resolveConfig(path);

  // Listed folders come first: they may sit outside the project, and checking the root first
  // would hand such a file to a config that has never heard of it.
  for (const directory of rules.scan) {
    if (isInside(path, directory)) {
      return { shouldScan: true, reason: `in a protected folder (${directory})` };
    }
  }

  if (!isInside(path, resolvePath(rules.root))) {
    // Almost certainly an --add-dir file, so let its own config answer.
    const decision = scanDecision(path, resolveConfig(path));
    return { shouldScan: decision.shouldScan, reason: `outside config root; ${decision.reason}` };
  }

  const reason = rules.protectsNothing
    ? "no folders configured for scanning"
    : "not in a protected folder";
  return { shouldScan: false, reason };
}

/** Just the answer from `scanDecision`, for callers that don't need the reason. */
export function shouldScan(filePath: string, config?: GuardConfig): boolean {
  return scanDecision(filePath, config).shouldScan;
}

// ---- Python's pathlib, which these rules were written for ----

/**
 * An absolute path with symlinks followed, like Python's `Path.resolve()`: the part that
 * exists is resolved for real, and the rest is appended as written.
 */
export function resolvePath(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return resolve(path);
      }
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** Whether `path` is `folder` or anything inside it, like Python's `is_relative_to`. */
export function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Expand a leading `~`, like Python's `expanduser`; throws for `~name`, which Node can't look up. */
function expandUser(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return join(homedir(), path.slice(1));
  }
  if (path.startsWith("~")) {
    throw new Error(`Could not determine home directory for ${path.split("/")[0]}.`);
  }
  return path;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Python's falsiness for a parsed YAML document: nothing, false, 0, "", [] or {}. */
function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return !value;
}

function isSystemError(error: unknown): error is Error {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

/** A value written as Python's `repr` would, so messages read the same as in Python. */
export function repr(value: unknown): string {
  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    const escaped = value.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`);
    return `${quote}${escaped}${quote}`;
  }
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (Array.isArray(value)) {
    return `[${value.map(repr).join(", ")}]`;
  }
  if (typeof value === "object") {
    const items = Object.entries(value).map(([key, item]) => `${repr(key)}: ${repr(item)}`);
    return `{${items.join(", ")}}`;
  }
  return String(value);
}
