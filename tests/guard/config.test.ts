/** Tests for the scan decision, ported from the Python `tests/guard/test_config.py`. */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  findConfigFile,
  type GuardConfig,
  isInside,
  loadConfig,
  resolveConfig,
  resolvePath,
  scanDecision,
  shouldScan,
} from "../../src/rezunateGuard/config";
import * as constants from "../../src/rezunateGuard/constants";
import { useIsolatedHome } from "./fixtures";

useIsolatedHome();

/** A fresh folder per test (pytest's `tmp_path`), resolved like Python's `tmp_path`. */
let tmp = "";
beforeEach(() => {
  tmp = resolvePath(mkdtempSync(join(tmpdir(), "guard-config-")));
});

function write(root: string, relative: string, content = "x"): string {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

function configFor(root: string, body: string): GuardConfig {
  write(root, constants.CONFIG_FILENAME, body);
  return loadConfig(join(root, constants.CONFIG_FILENAME));
}

// With no config file, the guard scans nothing — and must admit it.
describe("unconfigured", () => {
  it("scans nothing", () => {
    expect(shouldScan(write(tmp, "clients/acme.md"))).toBe(false);
  });

  it("makes the inert state detectable", () => {
    expect(resolveConfig(write(tmp, "clients/acme.md")).protectsNothing).toBe(true);
  });

  it("explains an inert decision", () => {
    expect(scanDecision(write(tmp, "clients/acme.md")).reason).toContain("no folders configured");
  });

  it("is not inert once configured", () => {
    expect(configFor(tmp, "scan:\n  - clients\n").protectsNothing).toBe(false);
  });
});

// What `init` writes must parse, and must protect nothing until edited.
describe("shipped template", () => {
  it("parses without error", () => {
    expect(configFor(tmp, constants.CONFIG_TEMPLATE).error).toBeNull();
  });

  it("is inert until edited", () => {
    expect(configFor(tmp, constants.CONFIG_TEMPLATE).protectsNothing).toBe(true);
  });

  it("becomes active when uncommented", () => {
    write(tmp, "clients/acme.md");
    const config = configFor(
      tmp,
      constants.CONFIG_TEMPLATE.replace("  # - clients", "  - clients"),
    );

    expect(config.protectsNothing).toBe(false);
    expect(shouldScan(join(tmp, "clients/acme.md"), config)).toBe(true);
    expect(shouldScan(join(tmp, "src/app.py"), config)).toBe(false);
  });
});

// A listed folder protects everything inside it, and nothing outside it.
describe("listed folders", () => {
  it("covers the folder and everything under it", () => {
    const config = configFor(tmp, "scan:\n  - clients\n");
    expect(shouldScan(join(tmp, "clients/acme.md"), config)).toBe(true);
    expect(shouldScan(join(tmp, "clients/2026/q1/acme.md"), config)).toBe(true);
    expect(shouldScan(join(tmp, "src/app.py"), config)).toBe(false);
  });

  it("doesn't let a nested folder protect its parent", () => {
    const config = configFor(tmp, "scan:\n  - data/patients\n");
    expect(shouldScan(join(tmp, "data/patients/list.csv"), config)).toBe(true);
    expect(shouldScan(join(tmp, "data/other.csv"), config)).toBe(false);
  });

  it("covers several folders", () => {
    const config = configFor(tmp, "scan:\n  - clients\n  - exports\n");
    expect(shouldScan(join(tmp, "clients/a.md"), config)).toBe(true);
    expect(shouldScan(join(tmp, "exports/b.csv"), config)).toBe(true);
    expect(shouldScan(join(tmp, "src/c.py"), config)).toBe(false);
  });

  // `clients` must not swallow `clients-archive`.
  it("matches a whole segment only", () => {
    const config = configFor(tmp, "scan:\n  - clients\n");
    expect(shouldScan(join(tmp, "clients-archive/a.md"), config)).toBe(false);
  });

  // A name never floats to any depth; it means that one folder.
  it("anchors a folder to the config", () => {
    const config = configFor(tmp, "scan:\n  - clients\n");
    expect(shouldScan(join(tmp, "packages/web/clients/a.md"), config)).toBe(false);
  });

  // No built-in exclusions. A broad scan really does pull in everything.
  it("scans everything inside", () => {
    const config = configFor(tmp, "scan:\n  - app\n");
    expect(shouldScan(join(tmp, "app/node_modules/react/index.js"), config)).toBe(true);
    expect(shouldScan(join(tmp, "app/uv.lock"), config)).toBe(true);
  });

  // A shipped `build/` exclusion would have made this protect nothing.
  it("has no hidden rule swallowing an explicit scan", () => {
    const config = configFor(tmp, "scan:\n  - build/exports\n");
    expect(shouldScan(join(tmp, "build/exports/customers.csv"), config)).toBe(true);
  });

  it("explains its decisions", () => {
    const config = configFor(tmp, "scan:\n  - clients\n");
    expect(scanDecision(join(tmp, "clients/a.md"), config).reason).toContain(
      "in a protected folder",
    );
    expect(scanDecision(join(tmp, "src/a.py"), config).reason).toContain(
      "not in a protected folder",
    );
  });
});

// An absolute path lets a config protect a folder outside its own project.
describe("absolute folders", () => {
  it("protects an absolute folder outside the project", () => {
    const outside = join(tmp, "share", "case-files");
    mkdirSync(outside, { recursive: true });
    const config = configFor(join(tmp, "project"), `scan:\n  - ${outside}\n`);

    expect(shouldScan(join(outside, "a.pdf"), config)).toBe(true);
    expect(shouldScan(join(outside, "deep/b.pdf"), config)).toBe(true);
    expect(shouldScan(join(tmp, "share/other.pdf"), config)).toBe(false);
  });

  it("expands a tilde", () => {
    expect(configFor(tmp, "scan:\n  - ~/records\n").scan).toEqual([
      resolvePath(join(homedir(), "records")),
    ]);
  });

  it("reads a dot as the whole project", () => {
    const config = configFor(tmp, "scan:\n  - '.'\n");
    expect(shouldScan(join(tmp, "src/app.py"), config)).toBe(true);
    expect(shouldScan(join(tmp, "clients/acme.md"), config)).toBe(true);
  });
});

describe("folder normalisation", () => {
  it.each(["clients", "clients/", "clients//"])("trims trailing slashes (%s)", (entry) => {
    expect(configFor(tmp, `scan:\n  - '${entry}'\n`).scan).toEqual([join(tmp, "clients")]);
  });

  it("ignores blank entries", () => {
    const config = configFor(tmp, "scan:\n  - ''\n  - '   '\n  - clients\n");
    expect(config.scan).toEqual([join(tmp, "clients")]);
  });

  it("takes a quoted comment as a folder name", () => {
    const config = configFor(tmp, "scan:\n  - '# not a folder'\n");
    expect(config.scan).toEqual([join(tmp, "# not a folder")]);
  });

  it("accepts a single folder written as a string", () => {
    const config = configFor(tmp, "scan: clients\n");
    expect(shouldScan(join(tmp, "clients/a.md"), config)).toBe(true);
  });
});

// A config we cannot read protects nothing. Only the log says why.
describe("nothing is scanned unless named", () => {
  it.each([
    ["malformed", "scan: [unclosed\n"],
    ["not-a-mapping", "- just\n- a\n- list\n"],
    ["misspelled-key", "scans:\n  - clients\n"],
    ["a-pattern", "scan:\n  - '*.csv'\n"],
    ["stray-colon", "scan:\n  - clients: \n"],
  ])("protects nothing with a config it cannot read (%s)", (_id, body) => {
    const config = configFor(tmp, body);
    expect(config.error).not.toBeNull();
    expect(config.protectsNothing).toBe(true);
    expect(shouldScan(join(tmp, "clients/acme.md"), config)).toBe(false);
  });

  it("names a pattern in the error", () => {
    expect(configFor(tmp, "scan:\n  - '*.csv'\n").error).toContain("*.csv");
  });

  it("names a misspelled key in the error", () => {
    expect(configFor(tmp, "scans:\n  - clients\n").error).toContain("scans");
  });

  it("protects nothing with an unreadable config", () => {
    const path = write(tmp, constants.CONFIG_FILENAME, "scan:\n  - clients\n");
    chmodSync(path, 0o000);
    let config: GuardConfig;
    try {
      config = loadConfig(path);
    } finally {
      chmodSync(path, 0o644);
    }
    expect(config.error).not.toBeNull();
    expect(shouldScan(join(tmp, "clients/a.md"), config)).toBe(false);
  });

  it("treats an empty config as inert, not broken", () => {
    const config = configFor(tmp, "");
    expect(config.error).toBeNull();
    expect(config.protectsNothing).toBe(true);
    expect(shouldScan(join(tmp, "clients/acme.md"), config)).toBe(false);
  });
});

// The log is the only thing that tells a user they are unprotected.
describe("problems are logged", () => {
  function logLines(): string[] {
    const path = constants.logPath();
    return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
  }

  it("logs a broken config", () => {
    configFor(tmp, "scans:\n  - clients\n");
    expect(logLines().some((line) => line.includes("unknown setting 'scans'"))).toBe(true);
  });

  it("logs a config listing nothing", () => {
    configFor(tmp, "");
    expect(logLines().some((line) => line.includes("no folders listed"))).toBe(true);
  });

  // A mis-indented list parses cleanly and names a folder that isn't there.
  it("logs a missing folder", () => {
    configFor(tmp, "scan:\n  clients\n  data\n");
    expect(logLines().some((line) => line.includes("folder not found"))).toBe(true);
  });

  it("doesn't log a folder that exists", () => {
    mkdirSync(join(tmp, "clients"));
    configFor(tmp, "scan:\n  - clients\n");
    expect(logLines()).toEqual([]);
  });
});

// One tool call asks about many paths, and they usually share a config.
describe("reusing a parse", () => {
  // Python counts calls to its private `_parse`; here, the cached object is returned again.
  it("parses an unchanged config once", () => {
    const path = write(tmp, constants.CONFIG_FILENAME, "scan:\n  - clients\n");
    const first = loadConfig(path);
    for (let i = 0; i < 10; i++) {
      expect(loadConfig(path)).toBe(first);
    }
  });

  it("parses an edited config again", () => {
    const path = write(tmp, constants.CONFIG_FILENAME, "scan:\n  - clients\n");
    expect(loadConfig(path).scan).toEqual([join(tmp, "clients")]);

    writeFileSync(path, "scan:\n  - exports\n", "utf8");
    expect(loadConfig(path).scan).toEqual([join(tmp, "exports")]);
  });
});

describe("discovery", () => {
  it("finds the config in a parent folder", () => {
    write(tmp, constants.CONFIG_FILENAME, "scan:\n  - clients\n");
    const target = write(tmp, "deep/nested/file.md");
    expect(findConfigFile(target)).toBe(join(tmp, constants.CONFIG_FILENAME));
  });

  it("lets the nearest config win", () => {
    write(tmp, constants.CONFIG_FILENAME, "scan:\n  - '.'\n");
    write(tmp, `apps/api/${constants.CONFIG_FILENAME}`, "scan:\n  - secrets\n");
    const target = write(tmp, "apps/api/notes.md");

    expect(findConfigFile(target)).toBe(join(tmp, "apps/api", constants.CONFIG_FILENAME));
    // The outer config would have scanned this; the inner one does not.
    expect(shouldScan(target)).toBe(false);
  });

  it("returns null when there is none", () => {
    expect(findConfigFile(write(tmp, "file.md"))).toBeNull();
  });
});

describe("path resolution", () => {
  // A --add-dir file must not be judged by another project's rules.
  it("judges a file outside the config root by its own config", () => {
    const config = configFor(join(tmp, "project"), "scan:\n  - '.'\n");
    write(join(tmp, "other"), constants.CONFIG_FILENAME, "scan:\n  - client-data\n");
    const outside = write(join(tmp, "other"), "client-data/notes.md");

    expect(scanDecision(outside, config).shouldScan).toBe(true);
  });

  // What keeps `scanDecision` from recursing, and its outside-root branch from firing for
  // callers that pass no config.
  it("always resolves a config that sits above its file", () => {
    write(join(tmp, "proj"), constants.CONFIG_FILENAME, "scan:\n  - clients\n");
    const paths = [
      write(join(tmp, "proj"), "clients/a.md"),
      write(join(tmp, "proj"), "deep/b.md"),
      write(join(tmp, "elsewhere"), "c.md"),
      "/etc/hosts",
    ];
    for (const path of paths) {
      const resolved = resolvePath(path);
      expect(isInside(resolved, resolvePath(resolveConfig(resolved).root))).toBe(true);
    }
  });

  it("doesn't scan a file outside any config", () => {
    const config = configFor(join(tmp, "project"), "scan:\n  - '.'\n");

    const decision = scanDecision(write(join(tmp, "other"), "notes.md"), config);
    expect(decision.shouldScan).toBe(false);
    expect(decision.reason).toContain("outside config root");
  });

  // A project protecting nothing has no say over a --add-dir file that is.
  it("doesn't let an inert project veto an outside project", () => {
    const config = configFor(join(tmp, "project"), "");
    expect(config.protectsNothing).toBe(true);

    write(join(tmp, "other"), constants.CONFIG_FILENAME, "scan:\n  - client-data\n");
    const outside = write(join(tmp, "other"), "client-data/notes.md");

    expect(scanDecision(outside, config).shouldScan).toBe(true);
  });

  it("lets two projects obey their own configs", () => {
    write(join(tmp, "strict"), constants.CONFIG_FILENAME, "scan:\n  - '.'\n");
    write(join(tmp, "loose"), constants.CONFIG_FILENAME, "scan:\n  - vault\n");

    expect(shouldScan(write(join(tmp, "strict"), "notes.md"))).toBe(true);
    expect(shouldScan(write(join(tmp, "loose"), "notes.md"))).toBe(false);
  });

  it("always reports a reason", () => {
    const config = configFor(tmp, "scan:\n  - clients\n");
    expect(scanDecision(write(tmp, "clients/a.md"), config).reason).toBeTruthy();
    expect(scanDecision(write(tmp, "src/a.py"), config).reason).toBeTruthy();
  });
});

describe("resolveConfig", () => {
  it("returns an inert default without any config", () => {
    const config = resolveConfig(write(tmp, "notes.md"));
    expect(config.source).toBeNull();
    expect(config.protectsNothing).toBe(true);
  });

  it("loads the project config", () => {
    write(tmp, constants.CONFIG_FILENAME, "scan:\n  - clients\n");
    expect(resolveConfig(write(tmp, "notes.md")).source).toBe(join(tmp, constants.CONFIG_FILENAME));
  });

  // So `scanDecision` reads it as unconfigured, not as another project's file.
  it("roots a file in no project at the filesystem root", () => {
    expect(resolveConfig(write(tmp, "key.pem")).root).toBe(parse(tmp).root);
  });
});
