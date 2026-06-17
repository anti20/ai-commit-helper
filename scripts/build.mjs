import { chmod, mkdir } from "node:fs/promises";

import { build } from "esbuild";

await mkdir("dist", { recursive: true });

await build({
  bundle: true,
  entryPoints: ["src/index.ts"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: "dist/index.js",
  packages: "external",
  platform: "node",
  target: "node20",
});

await chmod("dist/index.js", 0o755);
