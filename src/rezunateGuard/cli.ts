/** The `rezunate-guard` command: login, init, check. */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import packageJson from "../../package.json" with { type: "json" };
import { expandUser, scanDecision } from "./config";
import * as constants from "./constants";
import { write as writePrivate } from "./privateFile";

const PROG = "rezunate-guard";
const DESCRIPTION = "Redact PII from files before Claude Code sends them to the model.";

/** The package version. */
export const VERSION = packageJson.version;

// ANSI codes for the words `status` is really answering with.
const RED = "31";
const GREEN = "32";
const YELLOW = "33";
const DIM = "2";

/** Colour a word, or leave it alone when colour would be noise. */
function paint(text: string, code: string): string {
  const changeColour =
    process.env.NO_COLOR === undefined && process.env.TERM !== "dumb" && process.stdout.isTTY;
  return changeColour ? `\u001b[${code}m${text}\u001b[0m` : text;
}

/** Prompts, kept on one object so tests can replace them. */
export const prompts = {
  /** Ask for a secret without echoing it. Resolves "" if interrupted. */
  secret: readSecret,
};

/**
 * Ask for a key at a prompt that does not echo. Returns what was typed, or "" if the user gave
 * nothing or interrupted: the caller says so, since both leave you in the same place.
 */
async function promptForKey(): Promise<string> {
  console.log(`No key yet? Create one at ${constants.apiKeysUrl()}`);
  return (await prompts.secret("API key: ")).trim();
}

/** Save an API key to `~/.rezunate/credentials`, readable only by the user. */
async function commandLogin(args: { key?: string }): Promise<number> {
  const key = (args.key ?? "").trim() || (await promptForKey());

  if (!key) {
    console.error(paint(`no key given; create one at ${constants.apiKeysUrl()}`, RED));
    return 1;
  }

  const path = constants.credentialsPath();
  writePrivate(path, `${key}\n`);

  console.log(`${paint("key saved", GREEN)} to ${path}`);
  console.log("this key is not verified until the first scan; run `rezunate-guard status`");
  return 0;
}

/**
 * Write a config template into the current directory. The template is fully commented out,
 * so a fresh config protects nothing until the user edits it.
 */
function commandInit(args: { force: boolean }): number {
  const path = join(process.cwd(), constants.CONFIG_FILENAME);

  if (existsSync(path) && !args.force) {
    console.error(paint(`${path} already exists; pass --force to overwrite`, RED));
    return 1;
  }

  writeFileSync(path, constants.CONFIG_TEMPLATE, "utf8");

  console.log(`${paint("wrote", GREEN)} ${path}`);
  console.log();
  console.log(`${paint("Nothing is protected yet.", YELLOW)} Edit the \`scan:\` list, then run:`);
  console.log("  rezunate-guard status");
  return 0;
}

/** Print whether each given path would be scanned, and why. */
function commandCheck(args: { paths: string[] }): number {
  for (const name of args.paths) {
    const path = expandUser(name);
    const decision = scanDecision(path);
    const verdict = (decision.shouldScan ? "scan" : "skip").padEnd(5);
    const painted = paint(verdict, decision.shouldScan ? YELLOW : DIM);
    console.log(`${painted} ${path}  (${decision.reason})`);
  }
  return 0;
}

// ---- argument parsing ----

/** One subcommand: its help line, its usage, and how to run it from the parsed arguments. */
interface Command {
  help: string;
  usage: string;
  run: (values: Record<string, unknown>, positionals: string[]) => number | Promise<number>;
  options?: Record<string, { type: "boolean" }>;
}

const COMMANDS: Record<string, Command> = {
  login: {
    help: "save your RezunateLLM API key",
    usage: "login [-h] [key]",
    run: (_values, positionals) =>
      positionals.length > 1
        ? unrecognized("login", positionals.slice(1))
        : commandLogin({ key: positionals[0] }),
  },
  init: {
    help: `create ${constants.CONFIG_FILENAME} here`,
    usage: "init [-h] [--force]",
    options: { force: { type: "boolean" } },
    run: (values, positionals) =>
      positionals.length > 0
        ? unrecognized("init", positionals)
        : commandInit({ force: values.force === true }),
  },
  check: {
    help: "show whether given paths would be scanned",
    usage: "check [-h] paths [paths ...]",
    run: (_values, positionals) =>
      positionals.length === 0
        ? usageError("check", "the following arguments are required: paths")
        : commandCheck({ paths: positionals }),
  },
};

const CHOICES = `{${Object.keys(COMMANDS).join(",")}}`;
const MAIN_USAGE = `usage: ${PROG} [-h] [--version] ${CHOICES} ...`;

/** Print a usage error to stderr. Returns 2, the exit code for a usage error. */
function usageError(command: string | null, message: string): number {
  const usage = command ? `usage: ${PROG} ${COMMANDS[command]?.usage}` : MAIN_USAGE;
  const prog = command ? `${PROG} ${command}` : PROG;
  console.error(usage);
  console.error(`${prog}: error: ${message}`);
  return 2;
}

function unrecognized(command: string, extra: string[]): number {
  return usageError(command, `unrecognized arguments: ${extra.join(" ")}`);
}

function mainHelp(): string {
  const width = Math.max(CHOICES.length, ...Object.keys(COMMANDS).map((name) => name.length + 2));
  const rows = Object.entries(COMMANDS).map(
    ([name, command]) => `    ${name.padEnd(width - 2)}  ${command.help}`,
  );
  return [
    MAIN_USAGE,
    "",
    DESCRIPTION,
    "",
    "positional arguments:",
    `  ${CHOICES}`,
    ...rows,
    "",
    "options:",
    "  -h, --help            show this help message and exit",
    "  --version             show program's version number and exit",
  ].join("\n");
}

/** Run the CLI with `argv` (the arguments after the program name). Returns the exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [first, ...rest] = argv;

  if (first === "-h" || first === "--help") {
    console.log(mainHelp());
    return 0;
  }
  if (first === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (first === undefined) {
    return usageError(null, "the following arguments are required: command");
  }

  const command = COMMANDS[first];
  if (!command) {
    const choices = Object.keys(COMMANDS)
      .map((name) => `'${name}'`)
      .join(", ");
    return usageError(
      null,
      `argument command: invalid choice: '${first}' (choose from ${choices})`,
    );
  }

  if (rest.includes("-h") || rest.includes("--help")) {
    console.log(`usage: ${PROG} ${command.usage}`);
    return 0;
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      options: command.options ?? {},
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    const option = /'([^']+)'/.exec((error as Error).message)?.[1] ?? rest.join(" ");
    return unrecognized(first, [option]);
  }
  return command.run(parsed.values, parsed.positionals);
}

/** Read one line without echoing it. Resolves "" on Ctrl+C or end of input. */
function readSecret(question: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);

  if (!stdin.isTTY) {
    // Piped input: no echo to turn off, so read one line.
    return new Promise((resolve) => {
      const lines = createInterface({ input: stdin });
      let answered = false;
      lines.once("line", (line) => {
        answered = true;
        lines.close();
        resolve(line);
      });
      lines.once("close", () => {
        if (!answered) {
          console.error();
          resolve("");
        }
      });
    });
  }

  return new Promise((resolve) => {
    let typed = "";
    const finish = (value: string, interrupted: boolean) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      // Close the line the prompt left open (on stderr when interrupted).
      (interrupted ? process.stderr : stdout).write("\n");
      resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish(typed, false);
          return;
        }
        if (character === "\u0003" || character === "\u0004") {
          finish("", true);
          return;
        }
        typed =
          character === "\u007f" || character === "\b" ? typed.slice(0, -1) : typed + character;
      }
    };
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
