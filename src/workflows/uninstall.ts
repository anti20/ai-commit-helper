import { lstat, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import prompts from "prompts";

import { installerPathLine } from "../core/constants.js";
import { execFileAsync } from "../system/exec.js";
import { pathExists } from "../system/fs-utils.js";
import type { UninstallSummary } from "../core/types.js";

async function askForUninstallConfirmation(): Promise<boolean> {
  const response = await prompts({
    type: "text",
    name: "confirm",
    message: "Remove ai-commit-helper from this machine? [y/N]",
  });
  const answer = typeof response.confirm === "string" ? response.confirm.trim() : "";
  return ["y", "yes"].includes(answer.toLowerCase());
}

async function readPackageName(): Promise<string | null> {
  const packageJsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: unknown;
    };
    return typeof packageJson.name === "string" && packageJson.name.length > 0
      ? packageJson.name
      : null;
  } catch {
    return null;
  }
}

async function runNpmGlobalUninstall(packageName: string): Promise<boolean> {
  try {
    await execFileAsync("npm", ["ls", "-g", packageName, "--depth=0"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    await execFileAsync("npm", ["uninstall", "-g", packageName], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function uninstallNpmGlobalPackages(): Promise<boolean> {
  const packageName = await readPackageName();
  const packageNames = Array.from(
    new Set(["ai-commit-helper", packageName].filter(Boolean) as string[]),
  );
  let removed = false;

  for (const name of packageNames) {
    removed = (await runNpmGlobalUninstall(name)) || removed;
  }

  return removed;
}

async function removeKnownSymlink(): Promise<boolean> {
  const symlinkPath = join(homedir(), ".local", "bin", "ai-commit-helper");

  try {
    const stats = await lstat(symlinkPath);

    if (!stats.isSymbolicLink()) {
      return false;
    }

    await unlink(symlinkPath);
    return true;
  } catch {
    return false;
  }
}

async function removeInstallDirectory(): Promise<boolean> {
  const installDirectory = join(homedir(), ".ai-commit-helper");

  if (!(await pathExists(installDirectory))) {
    return false;
  }

  await rm(installDirectory, {
    recursive: true,
    force: true,
  });
  return true;
}

async function removeInstallerPathLine(shellConfigPath: string): Promise<boolean> {
  if (!(await pathExists(shellConfigPath))) {
    return false;
  }

  const contents = await readFile(shellConfigPath, "utf8");
  const lines = contents.split("\n");
  const filteredLines = lines.filter((line) => line.trim() !== installerPathLine);

  if (filteredLines.length === lines.length) {
    return false;
  }

  await writeFile(shellConfigPath, filteredLines.join("\n"), "utf8");
  console.log(chalk.green(`Removed ai-commit-helper PATH line from ${shellConfigPath}.`));
  return true;
}

async function cleanupShellConfigs(): Promise<boolean> {
  const shellConfigPaths = [
    join(homedir(), ".zshrc"),
    join(homedir(), ".bashrc"),
  ];
  let updated = false;

  for (const shellConfigPath of shellConfigPaths) {
    updated = (await removeInstallerPathLine(shellConfigPath)) || updated;
  }

  return updated;
}

function printUninstallSummary(summary: UninstallSummary): void {
  console.log();
  console.log(chalk.bold("Uninstall summary"));
  console.log(`removed symlink: ${summary.removedSymlink ? "yes" : "no"}`);
  console.log(
    `removed install directory: ${
      summary.removedInstallDirectory ? "yes" : "no"
    }`,
  );
  console.log(
    `removed npm global package: ${
      summary.removedNpmGlobalPackage ? "yes" : "no"
    }`,
  );
  console.log(`updated shell config: ${summary.updatedShellConfig ? "yes" : "no"}`);
}

export async function runUninstall(): Promise<void> {
  if (!(await askForUninstallConfirmation())) {
    console.log("Uninstall cancelled.");
    return;
  }

  const summary: UninstallSummary = {
    removedSymlink: await removeKnownSymlink(),
    removedInstallDirectory: await removeInstallDirectory(),
    removedNpmGlobalPackage: await uninstallNpmGlobalPackages(),
    updatedShellConfig: await cleanupShellConfigs(),
  };

  if (
    !summary.removedSymlink &&
    !summary.removedInstallDirectory &&
    !summary.removedNpmGlobalPackage &&
    !summary.updatedShellConfig
  ) {
    console.log("No ai-commit-helper installation was found.");
  }

  printUninstallSummary(summary);
}
