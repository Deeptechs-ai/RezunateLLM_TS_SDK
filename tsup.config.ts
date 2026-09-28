import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // tsup sets the deprecated `baseUrl` internally when emitting .d.ts, which TypeScript 6 rejects.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
});
