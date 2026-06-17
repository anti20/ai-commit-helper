import { homedir } from "node:os";
import { join } from "node:path";

export const diffPreviewLength = 1500;
export const generationTimeoutMs = 120_000;
export const installerPathLine = 'export PATH="$HOME/.local/bin:$PATH"';
export const userConfigPath = join(
  homedir(),
  ".config",
  "ai-commit-helper",
  "config.json",
);
