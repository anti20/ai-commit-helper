#!/usr/bin/env node

import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import prompts from "prompts";

void prompts;

const execFileAsync = promisify(execFile);
const diffPreviewLength = 1500;
const codexTimeoutMs = 120_000;

type AiProvider = "codex" | "openai";

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

async function isCodexCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", "command -v codex"], {
      cwd: process.cwd(),
    });
    return true;
  } catch {
    return false;
  }
}

async function detectAiProvider(): Promise<AiProvider | null> {
  if (await isCodexCliAvailable()) {
    return "codex";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return null;
}

function previewDiff(diff: string): string {
  return diff.length > diffPreviewLength
    ? `${diff.slice(0, diffPreviewLength)}\n...`
    : diff;
}

function buildGenerationPrompt(stagedDiff: string, userGoal?: string): string {
  const goalSection = userGoal
    ? `User goal:\n${userGoal}\n\n`
    : "User goal:\nNot provided.\n\n";

  return `You are generating human-readable Git change summaries.

Do not modify files.
Do not run commands.
Return text only.

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

async function generateWithCodex(stagedDiff: string): Promise<string> {
  const prompt = buildGenerationPrompt(stagedDiff);
  const outputPath = join(
    tmpdir(),
    `ai-commit-helper-codex-${randomUUID()}.txt`,
  );

  try {
    const { stdout, stderr } = await runCodexExec([
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

function runCodexExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
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
  provider: AiProvider,
  stagedDiff: string,
): Promise<string> {
  if (provider === "codex") {
    return generateWithCodex(stagedDiff);
  }

  throw new Error("OpenAI provider generation is not implemented yet.");
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
    console.log(chalk.cyan(`Using AI provider: ${aiProvider}`));
    console.log(previewDiff(stagedDiff));

    try {
      const generatedSummary = await generateSummary(aiProvider, stagedDiff);
      console.log();
      console.log(generatedSummary);
    } catch (error) {
      console.error(
        chalk.red(`Error generating summary with ${aiProvider}: ${getErrorMessage(error)}`),
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
  .action(async () => {
    await run();
  });

program.parse();
