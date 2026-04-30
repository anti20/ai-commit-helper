#!/usr/bin/env node

import chalk from "chalk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import prompts from "prompts";

void prompts;

const execFileAsync = promisify(execFile);
const diffPreviewLength = 1500;

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

async function isInsideGitRepository(): Promise<boolean> {
  try {
    const output = await runGit(["rev-parse", "--is-inside-work-tree"]);
    return output.trim() === "true";
  } catch {
    return false;
  }
}

async function readStagedDiff(): Promise<string> {
  return runGit(["diff", "--staged"]);
}

function previewDiff(diff: string): string {
  return diff.length > diffPreviewLength
    ? `${diff.slice(0, diffPreviewLength)}\n...`
    : diff;
}

async function run(): Promise<void> {
  if (!(await isInsideGitRepository())) {
    console.error(chalk.red("Error: current directory is not inside a Git repository."));
    process.exitCode = 1;
    return;
  }

  try {
    const stagedDiff = await readStagedDiff();

    if (stagedDiff.trim().length === 0) {
      console.log(chalk.yellow("No staged changes found. Run git add . first."));
      return;
    }

    console.log(chalk.green("Staged changes detected"));
    console.log(previewDiff(stagedDiff));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error reading staged changes: ${message}`));
    process.exitCode = 1;
  }
}

const program = new Command();

program
  .name("ai-commit-helper")
  .description("A CLI helper for creating commit messages.")
  .version("0.1.0")
  .action(async () => {
    await run();
  });

program.parse();
