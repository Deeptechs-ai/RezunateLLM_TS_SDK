/** Tests for the command line. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, prompts, VERSION } from "../../src/rezunateGuard/cli";
import * as constants from "../../src/rezunateGuard/constants";

/** A fake home for both `~/.claude` and `~/.rezunate`, and a project folder to work in. */
let home = "";
let project = "";
let out = "";
let err = "";
const saved = { cwd: process.cwd(), env: { ...process.env } };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "guard-cli-"));
  mkdirSync(join(home, "claude"));
  process.env[constants.CLAUDE_CONFIG_DIR_ENV] = join(home, "claude");
  process.env[constants.HOME_ENV] = join(home, "rezunate");
  delete process.env[constants.API_KEY_ENV];

  project = join(home, "work");
  mkdirSync(project);
  process.chdir(project);

  out = "";
  err = "";
  vi.spyOn(console, "log").mockImplementation((...args) => {
    out += `${args.join(" ")}\n`;
  });
  vi.spyOn(console, "error").mockImplementation((...args) => {
    err += `${args.join(" ")}\n`;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(saved.cwd);
  process.env = { ...saved.env };
  rmSync(home, { recursive: true, force: true });
});

const configPath = () => join(project, constants.CONFIG_FILENAME);

describe("init", () => {
  it("writes a config", async () => {
    expect(await main(["init"])).toBe(0);
    expect(existsSync(configPath())).toBe(true);
  });

  it("refuses to clobber", async () => {
    writeFileSync(configPath(), "scan:\n  - mine/**\n");
    expect(await main(["init"])).toBe(1);
    expect(err).toContain("already exists");
    expect(readFileSync(configPath(), "utf8")).toContain("mine");
  });

  it("overwrites with --force", async () => {
    writeFileSync(configPath(), "scan:\n  - mine/**\n");
    expect(await main(["init", "--force"])).toBe(0);
    expect(readFileSync(configPath(), "utf8")).not.toContain("mine");
  });
});

describe("login", () => {
  const credentials = () => join(home, "rezunate", "credentials");

  it("saves the key privately", async () => {
    expect(await main(["login", "sk-test-123"])).toBe(0);
    expect(readFileSync(credentials(), "utf8").trim()).toBe("sk-test-123");
    expect(statSync(credentials()).mode & 0o077).toBe(0);
  });

  it("rejects an empty key", async () => {
    vi.spyOn(prompts, "secret").mockResolvedValue("");
    expect(await main(["login"])).toBe(1);
  });

  // Someone running `login` without a key needs to be told where to get one.
  it("points at the dashboard when prompting", async () => {
    vi.spyOn(prompts, "secret").mockResolvedValue("sk-test-123");
    expect(await main(["login"])).toBe(0);
    expect(out).toContain(constants.apiKeysUrl());
  });

  // A key typed at a visible prompt survives in scrollback; that defeats the point.
  it("reads the key with the non-echoing prompt", async () => {
    const secret = vi.spyOn(prompts, "secret").mockResolvedValue("sk-test-123");
    expect(await main(["login"])).toBe(0);
    expect(secret).toHaveBeenCalledWith("API key: ");
  });

  it("builds the dashboard URL from the base URL", () => {
    process.env[constants.BASE_URL_ENV] = "http://localhost:8000/";
    expect(constants.apiKeysUrl()).toBe("http://localhost:8000/dashboard/apikeys");
  });

  it("overwrites a previous key", async () => {
    await main(["login", "old"]);
    await main(["login", "new"]);
    expect(readFileSync(credentials(), "utf8").trim()).toBe("new");
  });
});

describe("check", () => {
  it("explains each path", async () => {
    mkdirSync(join(project, "clients"));
    writeFileSync(configPath(), "scan:\n  - clients\n");
    expect(await main(["check", "clients/a.md", "src/b.py"])).toBe(0);

    expect(out).toContain("scan ");
    expect(out).toContain("skip ");
    expect(out).toContain("protected folder");
  });
});

describe("--version", () => {
  it("prints the packaged version", async () => {
    expect(await main(["--version"])).toBe(0);
    expect(out.trim()).toBe(VERSION);
  });
});
