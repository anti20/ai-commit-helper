import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import prompts from "prompts";

import { isExecutable } from "../system/fs-utils.js";
import { findCommandInPath } from "../system/command-path.js";
import type { ProviderName, ProviderSelection } from "../core/types.js";

export function isProviderName(value: string): value is ProviderName {
  return ["auto", "codex", "openai"].includes(value);
}

async function findCodexInPath(): Promise<string | null> {
  return findCommandInPath("codex");
}

async function findCodexInVersionDirs(baseDir: string): Promise<string | null> {
  let entries: string[];

  try {
    entries = await readdir(baseDir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const candidate = join(baseDir, entry, "bin", "codex");

    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function findCodexCli(): Promise<string | null> {
  const pathCodex = await findCodexInPath();

  if (pathCodex) {
    return pathCodex;
  }

  const home = homedir();
  const exactCandidates = [
    join(home, ".local", "bin", "codex"),
    join(home, ".npm-global", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];

  for (const candidate of exactCandidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  const versionDirCandidates = [
    join(home, ".nvm"),
    join(home, ".fnm"),
    join(home, ".local", "state", "fnm_multishells"),
  ];

  for (const baseDir of versionDirCandidates) {
    const codexPath = await findCodexInVersionDirs(baseDir);

    if (codexPath) {
      return codexPath;
    }
  }

  return null;
}

export async function detectAvailableProviders(): Promise<ProviderSelection[]> {
  const providers: ProviderSelection[] = [];
  const codexPath = await findCodexCli();

  if (codexPath) {
    providers.push({
      name: "codex",
      codexPath,
    });
  }

  if (process.env.OPENAI_API_KEY) {
    providers.push({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return providers;
}

export function providerNames(providers: ProviderSelection[]): string {
  return providers.map((provider) => provider.name).join(", ");
}

function missingProviderMessage(provider: Exclude<ProviderName, "auto">): string {
  switch (provider) {
    case "codex":
      return "Provider 'codex' was requested but Codex CLI was not found.";
    case "openai":
      return "Provider 'openai' was requested but OPENAI_API_KEY is not set.";
  }
}

async function askForProvider(
  providers: ProviderSelection[],
): Promise<ProviderSelection | null> {
  const response = await prompts({
    type: "select",
    name: "provider",
    message: "Which AI provider do you want to use?",
    choices: providers.map((provider) => ({
      title: provider.name,
      value: provider.name,
    })),
  });

  const selectedName = response.provider as ProviderSelection["name"] | undefined;
  return providers.find((provider) => provider.name === selectedName) ?? null;
}

export async function selectAiProvider(
  requestedProvider: ProviderName,
  providers: ProviderSelection[],
): Promise<ProviderSelection | null> {
  if (requestedProvider !== "auto") {
    const provider = providers.find(
      (availableProvider) => availableProvider.name === requestedProvider,
    );

    if (!provider) {
      throw new Error(missingProviderMessage(requestedProvider));
    }

    return provider;
  }

  if (providers.length === 0) {
    return null;
  }

  if (providers.length === 1) {
    return providers[0] ?? null;
  }

  return askForProvider(providers);
}
