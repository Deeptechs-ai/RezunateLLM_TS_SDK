/** Record problems the user would otherwise never hear about. */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as constants from "./constants";

/**
 * Add a problem to `~/.rezunate/guard.log`. Best effort: logging must never be the reason a
 * tool call fails, so file errors are ignored.
 * `source` is the config file the problem is in; `message` says what is wrong.
 */
export function problem(source: string, message: string): void {
  const text = message.split(/\s+/).filter(Boolean).join(" ").slice(0, constants.LOG_MAX_MESSAGE);
  const entry = `${source}: ${text}`;

  try {
    const path = constants.logPath();
    const lines = existsSync(path) && statSync(path).isFile() ? readLines(path) : [];
    if (lines.slice(-constants.LOG_RECENT_LINES).some((line) => line.endsWith(entry))) {
      return;
    }

    lines.push(`${timestamp(new Date())}  ${entry}`);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${lines.slice(-constants.LOG_MAX_LINES).join("\n")}\n`, "utf8");
  } catch (error) {
    // Only file-system errors (Python's OSError); anything else is a bug and is raised.
    if (!isSystemError(error)) {
      throw error;
    }
  }
}

/** The file's lines, without line endings (Python's `splitlines`). */
function readLines(path: string): string[] {
  const lines = readFileSync(path, "utf8").split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

/** Local time as "YYYY-MM-DD HH:MM". */
function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function isSystemError(error: unknown): boolean {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}
