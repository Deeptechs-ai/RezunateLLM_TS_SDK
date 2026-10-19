/** Write a file that only its owner can read. */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Write `data` to `path`, readable only by this user. Its folder is created if missing
 * (mode 0700). The mode is set at creation, never after, so the bytes are never briefly
 * readable by others. A pid-named temporary file takes the write first, so nobody sees a
 * half-written file and two processes cannot collide.
 * Throws if the file could not be written.
 */
export function write(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const temporary = join(dirname(path), `${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, data, { mode: 0o600 });

  renameSync(temporary, path);
}
