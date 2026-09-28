import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index";

// Placeholder test so the toolchain has something to run; replaced as modules are ported.
describe("package entry point", () => {
  it("exports a version string", () => {
    expect(typeof VERSION).toBe("string");
  });
});
