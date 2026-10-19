/**
 * Shared test setup for rezunate-guard, the counterpart of the Python `tests/guard/conftest.py`:
 * keep the test run off the developer's machine and off the network.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import * as constants from "../../src/rezunateGuard/constants";

/**
 * Point `REZUNATE_HOME` at a fresh temporary folder for every test, and clear any API key.
 * Returns a getter for the current test's home folder.
 */
export function useIsolatedHome(): () => string {
  let home = "";
  const saved = { home: process.env[constants.HOME_ENV], key: process.env[constants.API_KEY_ENV] };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rezunate-home-"));
    process.env[constants.HOME_ENV] = home;
    delete process.env[constants.API_KEY_ENV];
  });

  afterEach(() => {
    restore(constants.HOME_ENV, saved.home);
    restore(constants.API_KEY_ENV, saved.key);
    rmSync(home, { recursive: true, force: true });
  });

  return () => home;
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
