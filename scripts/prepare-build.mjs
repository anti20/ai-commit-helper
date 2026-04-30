#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const tscPath = join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(tscPath)) {
  run("npm", ["install", "--include=dev", "--ignore-scripts"]);
}

run("npm", ["run", "build"]);
