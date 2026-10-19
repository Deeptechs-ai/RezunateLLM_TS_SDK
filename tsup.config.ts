import { defineConfig } from "tsup";

export default defineConfig({
  // The library, and the `rezunate-guard` command (its entry keeps its `#!` line).
  entry: { index: "src/rezunateLlmSdk/index.ts", cli: "src/rezunateGuard/bin.ts" },
  format: ["esm", "cjs"],
  // Types for the library only. tsup sets the deprecated `baseUrl` internally when emitting
  // .d.ts, which TypeScript 6 rejects.
  dts: {
    entry: { index: "src/rezunateLlmSdk/index.ts" },
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
});
