import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    dts: true,
    format: ["esm", "cjs"],
    sourcemap: true,
    clean: true,
  },
  {
    entry: { "react/index": "src/react/index.ts" },
    dts: true,
    format: ["esm", "cjs"],
    sourcemap: true,
  },
])
