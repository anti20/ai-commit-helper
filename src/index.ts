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
import ora from "ora";
import prompts from "prompts";

const execFileAsync = promisify(execFile);
const diffPreviewLength = 1500;
const generationTimeoutMs = 120_000;

type ProviderName = "auto" | "codex" | "claude" | "openai" | "anthropic";

type ProviderSelection =
  | {
      name: "codex";
      codexPath: string;
    }
  | {
      name: "claude";
      claudePath: string;
    }
  | {
      name: "openai";
      apiKey: string;
    }
  | {
      name: "anthropic";
      apiKey: string;
    };

type CliOptions = {
  auto?: boolean;
  pr?: boolean;
  showDiff?: boolean;
  provider?: ProviderName;
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

async function findCommandInPath(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `command -v ${command}`], {
      cwd: process.cwd(),
    });
    const commandPath = stdout.trim().split("\n")[0];
    return commandPath.length > 0 ? commandPath : null;
  } catch {
    return null;
  }
}

async function findCodexInPath(): Promise<string | null> {
  return findCommandInPath("codex");
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

async function detectAvailableProviders(): Promise<ProviderSelection[]> {
  const providers: ProviderSelection[] = [];
  const codexPath = await findCodexCli();
  const claudePath = await findCommandInPath("claude");

  if (codexPath) {
    providers.push({
      name: "codex",
      codexPath,
    });
  }

  if (claudePath) {
    providers.push({
      name: "claude",
      claudePath,
    });
  }

  if (process.env.OPENAI_API_KEY) {
    providers.push({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      name: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  return providers;
}

function providerNames(providers: ProviderSelection[]): string {
  return providers.map((provider) => provider.name).join(", ");
}

function missingProviderMessage(provider: Exclude<ProviderName, "auto">): string {
  switch (provider) {
    case "codex":
      return "Provider 'codex' was requested but Codex CLI was not found.";
    case "claude":
      return "Provider 'claude' was requested but Claude CLI was not found.";
    case "openai":
      return "Provider 'openai' was requested but OPENAI_API_KEY is not set.";
    case "anthropic":
      return "Provider 'anthropic' was requested but ANTHROPIC_API_KEY is not set.";
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

async function selectAiProvider(
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
    return providers[0];
  }

  return askForProvider(providers);
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
Keep the output short and easy to copy.

Use the staged git diff and optional user goal below to generate exactly this structured output:

Commit message:
<one conventional commit message>

Changelog:
<one customer-safe changelog line>

Do not include a PR description.
Do not include testing notes.

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
Do not include separate Commit message or Changelog sections.

Use the staged git diff and optional user goal below to generate exactly this markdown structure:

## Summary
<high level explanation>

## Changes
<bullet points of changes>

## Why
<reason for the changes>

## Testing
<suggested or known verification steps based on the diff>

## Risk
<possible risks or side effects>

For Testing:
- Suggest relevant verification commands only when package scripts or project files make them visible or strongly implied.
- Do not claim any tests or commands were run.
- Do not write only "Not run; no commands executed."
- If no automated tests are evident from the diff, provide useful manual verification suggestions.

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

function extractOpenAiText(response: unknown): string {
  if (
    typeof response === "object" &&
    response !== null &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text.trim();
  }

  if (
    typeof response === "object" &&
    response !== null &&
    "output" in response &&
    Array.isArray(response.output)
  ) {
    const textParts: string[] = [];

    for (const item of response.output) {
      if (
        typeof item === "object" &&
        item !== null &&
        "content" in item &&
        Array.isArray(item.content)
      ) {
        for (const content of item.content) {
          if (
            typeof content === "object" &&
            content !== null &&
            "text" in content &&
            typeof content.text === "string"
          ) {
            textParts.push(content.text);
          }
        }
      }
    }

    return textParts.join("\n").trim();
  }

  return "";
}

async function generateWithOpenAi(
  apiKey: string,
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
): Promise<string> {
  const prompt = buildGenerationPrompt(mode, stagedDiff, userGoal);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, generationTimeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: prompt,
      }),
      signal: controller.signal,
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "error" in responseBody &&
        typeof responseBody.error === "object" &&
        responseBody.error !== null &&
        "message" in responseBody.error &&
        typeof responseBody.error.message === "string"
          ? responseBody.error.message
          : response.statusText;

      throw new Error(`OpenAI API request failed: ${message}`);
    }

    const output = extractOpenAiText(responseBody);

    if (output.length === 0) {
      throw new Error("OpenAI returned empty output.");
    }

    return output;
  } finally {
    clearTimeout(timeout);
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
    }, generationTimeoutMs);

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
        reject(new Error(`Codex timed out after ${generationTimeoutMs / 1000} seconds.`));
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

  if (provider.name === "openai") {
    return generateWithOpenAi(provider.apiKey, mode, stagedDiff, userGoal);
  }

  if (provider.name === "claude") {
    throw new Error(
      "Claude CLI generation is not implemented yet. Detection is available, but non-interactive CLI flags still need to be wired.",
    );
  }

  throw new Error(
    "Anthropic API generation is not implemented yet. Detection is available via ANTHROPIC_API_KEY.",
  );
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

    const availableProviders = await detectAvailableProviders();
    const requestedProvider = options.provider ?? "auto";

    if (!["auto", "codex", "claude", "openai", "anthropic"].includes(requestedProvider)) {
      console.error(
        chalk.red(
          `Unsupported provider '${requestedProvider}'. Supported values: auto, codex, claude, openai, anthropic.`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      chalk.cyan(
        `Available AI providers: ${
          availableProviders.length > 0 ? providerNames(availableProviders) : "none"
        }`,
      ),
    );

    let aiProvider: ProviderSelection | null;

    try {
      aiProvider = await selectAiProvider(
        requestedProvider,
        availableProviders,
      );
    } catch (error) {
      console.error(chalk.red(getErrorMessage(error)));
      process.exitCode = 1;
      return;
    }

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
      const spinner = ora(`Generating output with ${aiProvider.name}...`).start();
      let generatedSummary: string;

      try {
        generatedSummary = await generateSummary(
          aiProvider,
          mode,
          stagedDiff,
          userGoal,
        );
        spinner.stop();
      } catch (error) {
        spinner.stop();
        throw error;
      }

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
  .option(
    "--provider <provider>",
    "AI provider to use: auto, codex, claude, openai, or anthropic",
    "auto",
  )
  .action(async (options: CliOptions) => {
    await run(options);
  });

program.parse();
