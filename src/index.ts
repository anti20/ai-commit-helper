#!/usr/bin/env node

import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import prompts from "prompts";

const execFileAsync = promisify(execFile);
const diffPreviewLength = 1500;
const codexTimeoutMs = 120_000;

type AiProvider = "codex" | "openai";

type ProviderSelection =
  | {
      name: "codex";
      codexPath: string;
    }
  | {
      name: "openai";
    };

type CliOptions = {
  auto?: boolean;
  pr?: boolean;
  showDiff?: boolean;
};

type OutputMode = "summary" | "pr";

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

async function findCodexInPath(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", "command -v codex"], {
      cwd: process.cwd(),
    });
    const codexPath = stdout.trim().split("\n")[0];
    return codexPath.length > 0 ? codexPath : null;
  } catch {
    return null;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
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

async function detectAiProvider(): Promise<ProviderSelection | null> {
  const codexPath = await findCodexCli();

  if (codexPath) {
    return {
      name: "codex",
      codexPath,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      name: "openai",
    };
  }

  return null;
}

function previewDiff(diff: string): string {
  return diff.length > diffPreviewLength
    ? `${diff.slice(0, diffPreviewLength)}\n...`
    : diff;
}

async function askForUserGoal(): Promise<string | undefined> {
  const response = await prompts({
    type: "text",
    name: "goal",
    message: "What is the main goal of these changes?",
  });

  const goal = typeof response.goal === "string" ? response.goal.trim() : "";
  return goal.length > 0 ? goal : undefined;
}

function buildSummaryPrompt(stagedDiff: string, userGoal?: string): string {
  const goalSection = userGoal
    ? `User goal:
${userGoal}

Use the user goal as important context. If the staged diff appears to contradict the user goal, mention that mismatch in the generated output.

`
    : "User goal:\nNot provided.\n\n";

  return `You are generating human-readable Git change summaries.

Do not modify files.
Do not run commands.
Return text only.
Keep the output concise and easy to copy.

Use the staged git diff and optional user goal below to generate exactly this structured output:

Commit message:
<one conventional commit message>

PR description:
<markdown PR description>

Changelog:
<one customer-safe changelog line>

Testing notes:
<short testing notes>

${goalSection}Staged git diff:
\`\`\`diff
${stagedDiff}
\`\`\``;
}

function buildPrPrompt(stagedDiff: string, userGoal?: string): string {
  const goalSection = userGoal
    ? `User goal:
${userGoal}

Use the user goal as important context. If the staged diff appears to contradict the user goal, mention that mismatch in the generated output.

`
    : "User goal:\nNot provided.\n\n";

  return `You are generating a pull request description.

Do not modify files.
Do not run commands.
Return markdown text only.
Keep the output concise and easy to copy.

Use the staged git diff and optional user goal below to generate exactly this markdown structure:

## Summary
<high level explanation>

## Changes
<bullet points of changes>

## Why
<reason for the changes>

## Testing
<how to test>

## Risk
<possible risks or side effects>

${goalSection}Staged git diff:
\`\`\`diff
${stagedDiff}
\`\`\``;
}

function buildGenerationPrompt(
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
): string {
  return mode === "pr"
    ? buildPrPrompt(stagedDiff, userGoal)
    : buildSummaryPrompt(stagedDiff, userGoal);
}

function getErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.trim().length > 0
  ) {
    return error.stderr.trim();
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function generateWithCodex(
  codexPath: string,
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
): Promise<string> {
  const prompt = buildGenerationPrompt(mode, stagedDiff, userGoal);
  const outputPath = join(
    tmpdir(),
    `ai-commit-helper-codex-${randomUUID()}.txt`,
  );

  try {
    const { stdout, stderr } = await runCodexExec(codexPath, [
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "--output-last-message",
      outputPath,
      prompt,
    ]);

    const outputFile = await readFile(outputPath, "utf8").catch(() => "");
    const output = outputFile.trim() || stdout.trim();

    if (output.length === 0) {
      const details = stderr.trim() || "Codex returned empty output.";
      throw new Error(details);
    }

    return output;
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

function runCodexExec(
  codexPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(codexPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, codexTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (timedOut) {
        reject(new Error(`Codex timed out after ${codexTimeoutMs / 1000} seconds.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `Codex exited with code ${code}.`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function generateSummary(
  provider: ProviderSelection,
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
): Promise<string> {
  if (provider.name === "codex") {
    return generateWithCodex(provider.codexPath, mode, stagedDiff, userGoal);
  }

  throw new Error("OpenAI provider generation is not implemented yet.");
}

function printGeneratedSummary(summary: string): void {
  console.log();
  console.log(chalk.bold("Generated output"));
  console.log("=".repeat("Generated output".length));
  console.log(summary.trim());
}

async function run(options: CliOptions): Promise<void> {
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

    const aiProvider = await detectAiProvider();

    if (!aiProvider) {
      console.error(
        chalk.red(
          "No AI provider found. Install/login to Codex CLI or set OPENAI_API_KEY.",
        ),
      );
      process.exitCode = 1;
      return;
    }

    console.log(chalk.green("Staged changes detected"));
    console.log(chalk.cyan(`Using AI provider: ${aiProvider.name}`));

    if (aiProvider.name === "codex") {
      console.log(chalk.cyan(`Using Codex CLI: ${aiProvider.codexPath}`));
    }

    if (options.showDiff) {
      console.log(previewDiff(stagedDiff));
    }

    try {
      const mode: OutputMode = options.pr ? "pr" : "summary";
      const userGoal = options.auto ? undefined : await askForUserGoal();
      const generatedSummary = await generateSummary(
        aiProvider,
        mode,
        stagedDiff,
        userGoal,
      );
      printGeneratedSummary(generatedSummary);
    } catch (error) {
      console.error(
        chalk.red(
          `Error generating summary with ${aiProvider.name}: ${getErrorMessage(error)}`,
        ),
      );
      process.exitCode = 1;
    }
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(chalk.red(`Error reading staged changes: ${message}`));
    process.exitCode = 1;
  }
}

const program = new Command();

program
  .name("ai-commit-helper")
  .description("A CLI helper for creating commit messages.")
  .version("0.1.0")
  .option("--auto", "infer the goal from the staged diff without prompting")
  .option("--pr", "generate a markdown pull request description")
  .option("--show-diff", "print a preview of the staged diff")
  .action(async (options: CliOptions) => {
    await run(options);
  });

program.parse();
