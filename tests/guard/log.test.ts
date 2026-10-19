/** Tests for the problem log, ported from the Python `tests/guard/test_log.py`. */

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as constants from "../../src/rezunateGuard/constants";
import { problem } from "../../src/rezunateGuard/log";
import { useIsolatedHome } from "./fixtures";

const home = useIsolatedHome();

const SOURCE = "/project/.rezunate-guard.yaml";

function lines(): string[] {
  const path = constants.logPath();
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
}

describe("writing", () => {
  it("writes a problem", () => {
    problem(SOURCE, "folder not found: /project/clients");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain(SOURCE);
    expect(lines()[0]).toContain("folder not found: /project/clients");
  });

  it("stamps each line", () => {
    problem(SOURCE, "something went wrong");
    expect(lines()[0]?.startsWith("20")).toBe(true);
  });

  it("writes different problems", () => {
    problem(SOURCE, "first");
    problem(SOURCE, "second");
    expect(lines()).toHaveLength(2);
  });

  // A YAML error arrives with newlines, which would break both the log and the repeat check.
  it("turns a multi-line message into one line", () => {
    problem(SOURCE, "could not read config:\nline 2\ncolumn 1");
    expect(lines()).toHaveLength(1);
  });

  it("trims a long message", () => {
    problem(SOURCE, "x".repeat(500));
    expect(lines()[0]?.length).toBeLessThan(200);
  });
});

// The hook runs once per tool call, so the same problem arrives again and again.
describe("not repeating itself", () => {
  it("writes the same problem once", () => {
    for (let i = 0; i < 50; i++) {
      problem(SOURCE, "folder not found: /project/clients");
    }
    expect(lines()).toHaveLength(1);
  });

  // Comparing against only the last line would let three problems take turns.
  it("keeps several live problems quiet together", () => {
    for (let i = 0; i < 20; i++) {
      for (const name of ["clients", "exports", "records"]) {
        problem(SOURCE, `folder not found: /project/${name}`);
      }
    }
    expect(lines()).toHaveLength(3);
  });
});

describe("staying small", () => {
  it("stops the log growing", () => {
    for (let index = 0; index < constants.LOG_MAX_LINES * 3; index++) {
      problem(`/project-${index}/.rezunate-guard.yaml`, "unknown setting");
    }
    expect(lines()).toHaveLength(constants.LOG_MAX_LINES);
  });

  it("keeps the newest problems", () => {
    for (let index = 0; index < constants.LOG_MAX_LINES * 2; index++) {
      problem(`/project-${index}/.rezunate-guard.yaml`, "unknown setting");
    }
    expect(lines().join("\n")).not.toContain("/project-0/");
    expect(lines().at(-1)).toContain(`/project-${constants.LOG_MAX_LINES * 2 - 1}/`);
  });
});

describe("never failing", () => {
  // Logging must never be the reason a tool call fails.
  it("ignores an unwritable home", () => {
    chmodSync(home(), 0o500);
    try {
      expect(() => problem(SOURCE, "cannot be written")).not.toThrow();
    } finally {
      chmodSync(home(), 0o700);
    }
  });
});
