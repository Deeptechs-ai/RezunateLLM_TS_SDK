/** Tests for writing owner-only files. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { write } from "../../src/rezunateGuard/privateFile";
import { useIsolatedHome } from "./fixtures";

const home = useIsolatedHome();

describe("write", () => {
  it("writes the data readable only by its owner, creating the folder", () => {
    const path = join(home(), "nested", "credentials");

    write(path, "secret");

    expect(readFileSync(path, "utf8")).toBe("secret");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home(), "nested")).mode & 0o777).toBe(0o700);
  });

  it("replaces an existing file and leaves no temporary file behind", () => {
    const path = join(home(), "credentials");
    write(path, "old");

    write(path, "new");

    expect(readFileSync(path, "utf8")).toBe("new");
    expect(readdirSync(home())).toEqual(["credentials"]);
  });
});
