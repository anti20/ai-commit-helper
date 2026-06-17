import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { userConfigPath } from "../core/constants.js";
import { pathExists } from "../system/fs-utils.js";
import type { CliOptions, UserConfig } from "../core/types.js";

export function parseStyleCommitCount(value: string | undefined): number {
  const rawValue = value ?? "5";
  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--style-commits must be a non-negative integer.");
  }

  return parsed;
}

export function parseBooleanConfigValue(value: string): boolean {
  const normalizedValue = value.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  throw new Error("styleMatch must be true or false.");
}

export function parseUserConfig(contents: string): UserConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid JSON in ${userConfigPath}.`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid config in ${userConfigPath}.`);
  }

  const rawConfig = parsed as Record<string, unknown>;
  const config: UserConfig = {};

  if (rawConfig.styleCommits !== undefined) {
    if (
      typeof rawConfig.styleCommits !== "number" ||
      !Number.isInteger(rawConfig.styleCommits) ||
      rawConfig.styleCommits < 0
    ) {
      throw new Error("Config value styleCommits must be a non-negative integer.");
    }

    config.styleCommits = rawConfig.styleCommits;
  }

  if (rawConfig.styleMatch !== undefined) {
    if (typeof rawConfig.styleMatch !== "boolean") {
      throw new Error("Config value styleMatch must be true or false.");
    }

    config.styleMatch = rawConfig.styleMatch;
  }

  return config;
}

export async function readUserConfig(): Promise<UserConfig> {
  if (!(await pathExists(userConfigPath))) {
    return {};
  }

  return parseUserConfig(await readFile(userConfigPath, "utf8"));
}

export async function writeUserConfig(config: UserConfig): Promise<void> {
  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function resolveStyleCommitCount(
  options: CliOptions,
  config: UserConfig,
): number {
  if (options.styleMatch === false) {
    return 0;
  }

  if (options.styleCommits !== undefined) {
    return parseStyleCommitCount(options.styleCommits);
  }

  if (config.styleMatch === false) {
    return 0;
  }

  return config.styleCommits ?? 5;
}
