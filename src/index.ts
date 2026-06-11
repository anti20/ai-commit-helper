#!/usr/bin/env node

import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Command } from "commander";
import ora from "ora";
import prompts from "prompts";

const execFileAsync = promisify(execFile);
const diffPreviewLength = 1500;
const generationTimeoutMs = 120_000;
const installerPathLine = 'export PATH="$HOME/.local/bin:$PATH"';
const userConfigPath = join(homedir(), ".config", "ai-commit-helper", "config.json");

type ProviderName = "auto" | "codex" | "openai";

type ProviderSelection =
  | {
      name: "codex";
      codexPath: string;
    }
  | {
      name: "openai";
      apiKey: string;
    };

type CliOptions = {
  auto?: boolean;
  autoStage?: boolean;
  pr?: boolean;
  showDiff?: boolean;
  provider?: ProviderName;
  styleCommits?: string;
  styleMatch?: boolean;
};

type UserConfig = {
  styleCommits?: number;
  styleMatch?: boolean;
};

type OutputMode = "summary" | "pr";
type PrAction = "copy" | "none";
type SummaryAction =
  | "commit"
  | "commit-push"
  | "copy"
  | "regenerate"
  | "edit"
  | "none";

type UninstallSummary = {
  removedSymlink: boolean;
  removedInstallDirectory: boolean;
  removedNpmGlobalPackage: boolean;
  updatedShellConfig: boolean;
};

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

async function stageAllChanges(): Promise<void> {
  await runGit(["add", "."]);
}

async function readRecentCommitMessages(limit = 5): Promise<string[]> {
  if (limit <= 0) {
    return [];
  }

  try {
    const output = await runGit([
      "log",
      `-${limit}`,
      "--format=%B%x1e",
    ]);

    return output
      .split("\x1e")
      .map((message) => message.trim())
      .filter((message) => message.length > 0);
  } catch {
    return [];
  }
}

function parseStyleCommitCount(value: string | undefined): number {
  const rawValue = value ?? "5";
  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--style-commits must be a non-negative integer.");
  }

  return parsed;
}

function parseBooleanConfigValue(value: string): boolean {
  const normalizedValue = value.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  throw new Error("styleMatch must be true or false.");
}

function parseUserConfig(contents: string): UserConfig {
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

async function readUserConfig(): Promise<UserConfig> {
  if (!(await pathExists(userConfigPath))) {
    return {};
  }

  return parseUserConfig(await readFile(userConfigPath, "utf8"));
}

async function writeUserConfig(config: UserConfig): Promise<void> {
  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function resolveStyleCommitCount(
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

function providerNames(providers: ProviderSelection[]): string {
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

function buildSummaryPrompt(
  stagedDiff: string,
  userGoal?: string,
  recentCommitMessages: string[] = [],
): string {
  const goalSection = userGoal
    ? `User goal:
${userGoal}

Use the user goal as important context. If the staged diff appears to contradict the user goal, mention that mismatch in the generated output.

`
    : "User goal:\nNot provided.\n\n";
  const commitStyleSection =
    recentCommitMessages.length > 0
      ? `Recent commit messages to match stylistically:
${recentCommitMessages
  .map((message, index) => `${index + 1}. ${message}`)
  .join("\n\n")}

Use these recent commit messages as the primary style guide for the new commit message. Match their format, casing, punctuation, level of detail, language, and whether they use a body. If the recent commits consistently use conventional commit format, use it too. If they do not, do not force conventional commit format.

`
      : `Recent commit messages to match stylistically:
Not available.

`;

  return `You are generating human-readable Git change summaries.

Do not modify files.
Do not run commands.
Return text only.
Keep the output short and easy to copy.

Use the staged git diff and optional user goal below to generate exactly this structured output:

Commit message:
<style-matched commit title>

<optional style-matched body when the repository's recent commits use one>

Changelog:
<user-facing changelog bullets>

Commit message rules:
- Match the style of the recent commit messages below.
- The first line must be a short title.
- Summarize the overall change, not just the first or most obvious change.
- If multiple major changes exist, use a broader title.
- A multi-line commit message is allowed.
- Add a commit body only when it fits the recent commit style and there are multiple meaningful changes.
- When adding a body, follow the recent commit style and include only the top 3-4 most important changes.
- Do not include every tiny change in the commit body.

Changelog rules:
- Include all meaningful user-facing changes.
- The changelog can include more than 3-4 items when the diff warrants it.
- Do not include purely internal refactors unless they affect user behavior.
- Use clear user-facing wording.

Do not include a PR description.
Do not include testing notes.

${commitStyleSection}${goalSection}Staged git diff:
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
  recentCommitMessages: string[] = [],
): string {
  return mode === "pr"
    ? buildPrPrompt(stagedDiff, userGoal)
    : buildSummaryPrompt(stagedDiff, userGoal, recentCommitMessages);
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
  recentCommitMessages: string[] = [],
): Promise<string> {
  const prompt = buildGenerationPrompt(
    mode,
    stagedDiff,
    userGoal,
    recentCommitMessages,
  );
  const outputPath = join(
    tmpdir(),
    `ai-commit-helper-codex-${randomUUID()}.txt`,
  );

  try {
    const args = buildCodexExecArgs(prompt, outputPath);
    let result: { stdout: string; stderr: string };

    try {
      result = await runCodexExec(codexPath, args);
    } catch (error) {
      if (!isCodexConfigLoadError(error)) {
        throw error;
      }

      result = await runCodexExec(
        codexPath,
        buildCodexExecArgs(prompt, outputPath, {
          ignoreUserConfig: true,
        }),
      );
    }

    const { stdout, stderr } = result;
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

function buildCodexExecArgs(
  prompt: string,
  outputPath: string,
  options: { ignoreUserConfig?: boolean } = {},
): string[] {
  return [
    "exec",
    ...(options.ignoreUserConfig ? ["--ignore-user-config"] : []),
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "--output-last-message",
    outputPath,
    prompt,
  ];
}

function isCodexConfigLoadError(error: unknown): boolean {
  return getErrorMessage(error).includes("Error loading config.toml");
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
  recentCommitMessages: string[] = [],
): Promise<string> {
  const prompt = buildGenerationPrompt(
    mode,
    stagedDiff,
    userGoal,
    recentCommitMessages,
  );
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
  recentCommitMessages: string[] = [],
): Promise<string> {
  if (provider.name === "codex") {
    return generateWithCodex(
      provider.codexPath,
      mode,
      stagedDiff,
      userGoal,
      recentCommitMessages,
    );
  }

  if (provider.name === "openai") {
    return generateWithOpenAi(
      provider.apiKey,
      mode,
      stagedDiff,
      userGoal,
      recentCommitMessages,
    );
  }

  throw new Error(`Unsupported AI provider: ${provider satisfies never}.`);
}

function printGeneratedSummary(summary: string): void {
  console.log();
  console.log(chalk.bold("Generated output"));
  console.log("=".repeat("Generated output".length));
  console.log(summary.trim());
}

async function copyToClipboard(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pbcopy", {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        reject(new Error(stderr || `pbcopy exited with code ${code}.`));
        return;
      }

      resolve();
    });

    child.stdin.end(text);
  });
}

async function askForPrAction(): Promise<PrAction | null> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: "What do you want to do?",
    choices: [
      {
        title: "Copy PR description",
        value: "copy",
      },
      {
        title: "Do nothing",
        value: "none",
      },
    ],
  });

  return (response.action as PrAction | undefined) ?? null;
}

async function handlePrActions(prDescription: string): Promise<void> {
  const action = await askForPrAction();

  if (action === "copy") {
    await copyToClipboard(prDescription);
    console.log(chalk.green("Copied PR description to clipboard."));
  }
}

function extractCommitMessage(generatedOutput: string): string {
  const commitHeader = "Commit message:";
  const changelogHeader = "Changelog:";
  const commitStart = generatedOutput.indexOf(commitHeader);

  if (commitStart === -1) {
    throw new Error("Generated output did not include a Commit message section.");
  }

  const messageStart = commitStart + commitHeader.length;
  const changelogStart = generatedOutput.indexOf(changelogHeader, messageStart);
  const commitMessage = generatedOutput
    .slice(messageStart, changelogStart === -1 ? undefined : changelogStart)
    .trim();

  if (commitMessage.length === 0) {
    throw new Error("Generated commit message was empty.");
  }

  return commitMessage;
}

async function askForSummaryAction(): Promise<SummaryAction | null> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: "What do you want to do?",
    choices: [
      {
        title: "Commit",
        value: "commit",
      },
      {
        title: "Commit and push",
        value: "commit-push",
      },
      {
        title: "Copy commit message",
        value: "copy",
      },
      {
        title: "Regenerate commit message",
        value: "regenerate",
      },
      {
        title: "Edit commit message",
        value: "edit",
      },
      {
        title: "Do nothing",
        value: "none",
      },
    ],
  });

  return (response.action as SummaryAction | undefined) ?? null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function findCommitMessageEditor(): Promise<string | null> {
  if (process.env.VISUAL) {
    return process.env.VISUAL;
  }

  if (process.env.EDITOR) {
    return process.env.EDITOR;
  }

  return (
    (await findCommandInPath("nano")) ??
    (await findCommandInPath("vim")) ??
    (await findCommandInPath("vi"))
  );
}

async function askForEditedCommitMessage(commitMessage: string): Promise<string> {
  const editor = await findCommitMessageEditor();

  if (!editor) {
    console.log(chalk.yellow("No terminal editor found. Keeping previous message."));
    return commitMessage;
  }

  const messagePath = join(
    tmpdir(),
    `ai-commit-helper-edit-${randomUUID()}.txt`,
  );

  try {
    await writeFile(messagePath, `${commitMessage.trim()}\n`, "utf8");
    console.log(chalk.cyan(`Opening commit message in ${editor}...`));

    await new Promise<void>((resolve, reject) => {
      const child = spawn("sh", ["-c", `${editor} ${shellQuote(messagePath)}`], {
        cwd: process.cwd(),
        stdio: "inherit",
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`${editor} exited with code ${code}.`));
          return;
        }

        resolve();
      });
    });

    const editedCommitMessage = (await readFile(messagePath, "utf8")).trim();

    if (editedCommitMessage.length === 0) {
      console.log(chalk.yellow("Commit message cannot be empty. Keeping previous message."));
      return commitMessage;
    }

    return editedCommitMessage;
  } finally {
    await unlink(messagePath).catch(() => undefined);
  }
}

async function commitWithMessage(commitMessage: string): Promise<void> {
  const stagedDiff = await readStagedDiff();

  if (stagedDiff.trim().length === 0) {
    throw new Error("No staged changes found. Run git add . first.");
  }

  const messagePath = join(
    tmpdir(),
    `ai-commit-helper-message-${randomUUID()}.txt`,
  );

  try {
    await writeFile(messagePath, `${commitMessage.trim()}\n`, "utf8");
    await runGit(["commit", "-F", messagePath]);
  } finally {
    await unlink(messagePath).catch(() => undefined);
  }
}

async function handleSummaryActions(
  generatedOutput: string,
  regenerateSummary?: () => Promise<string>,
): Promise<void> {
  let commitMessage = extractCommitMessage(generatedOutput);

  while (true) {
    const action = await askForSummaryAction();

    if (!action || action === "none") {
      return;
    }

    if (action === "regenerate") {
      if (!regenerateSummary) {
        console.log(chalk.yellow("Regenerate is not available."));
        continue;
      }

      generatedOutput = await regenerateSummary();
      printGeneratedSummary(generatedOutput);
      commitMessage = extractCommitMessage(generatedOutput);
      continue;
    }

    if (action === "edit") {
      commitMessage = await askForEditedCommitMessage(commitMessage);
      console.log(chalk.green("Updated commit message:"));
      console.log(commitMessage);
      continue;
    }

    if (action === "copy") {
      await copyToClipboard(commitMessage);
      console.log(chalk.green("Copied commit message to clipboard."));
      return;
    }

    await commitWithMessage(commitMessage);
    console.log(chalk.green("Created commit."));

    if (action === "commit-push") {
      await runGit(["push"]);
      console.log(chalk.green("Pushed commit."));
    }

    return;
  }
}

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

async function runUninstall(): Promise<void> {
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

async function runConfigSet(key: string, value: string): Promise<void> {
  try {
    const config = await readUserConfig();
    let savedValue: string;

    if (key === "styleCommits") {
      config.styleCommits = parseStyleCommitCount(value);
      savedValue = String(config.styleCommits);
    } else if (key === "styleMatch") {
      config.styleMatch = parseBooleanConfigValue(value);
      savedValue = String(config.styleMatch);
    } else {
      throw new Error("Unsupported config key. Supported keys: styleCommits, styleMatch.");
    }

    await writeUserConfig(config);
    console.log(chalk.green(`Saved ${key}=${savedValue} to ${userConfigPath}.`));
  } catch (error) {
    console.error(chalk.red(getErrorMessage(error)));
    process.exitCode = 1;
  }
}

async function run(options: CliOptions): Promise<void> {
  if (!(await isInsideGitRepository())) {
    console.error(chalk.red("Error: current directory is not inside a Git repository."));
    process.exitCode = 1;
    return;
  }

  let userConfig: UserConfig;

  try {
    userConfig = await readUserConfig();
  } catch (error) {
    console.error(chalk.red(getErrorMessage(error)));
    process.exitCode = 1;
    return;
  }

  try {
    const styleCommitCount = resolveStyleCommitCount(options, userConfig);

    if (options.auto && options.autoStage !== false) {
      await stageAllChanges();
      console.log(chalk.green("Staged changes with git add ."));
    }

    const stagedDiff = await readStagedDiff();

    if (stagedDiff.trim().length === 0) {
      console.log(chalk.yellow("No staged changes found."));
      return;
    }

    const availableProviders = await detectAvailableProviders();
    const requestedProvider = options.provider ?? "auto";

    if (!["auto", "codex", "openai"].includes(requestedProvider)) {
      console.error(
        chalk.red(
          `Unsupported provider '${requestedProvider}'. Supported values: codex or openai.`,
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
      const recentCommitMessages =
        mode === "summary" ? await readRecentCommitMessages(styleCommitCount) : [];
      const generateOutput = async (message: string): Promise<string> => {
        const spinner = ora(message).start();

        try {
          const generatedSummary = await generateSummary(
            aiProvider,
            mode,
            stagedDiff,
            userGoal,
            recentCommitMessages,
          );
          spinner.stop();
          return generatedSummary;
        } catch (error) {
          spinner.stop();
          throw error;
        }
      };
      const generatedSummary = await generateOutput(
        `Generating output with ${aiProvider.name}...`,
      );

      printGeneratedSummary(generatedSummary);

      try {
        if (mode === "pr") {
          await handlePrActions(generatedSummary);
        } else {
          await handleSummaryActions(generatedSummary, () =>
            generateOutput(`Regenerating commit message with ${aiProvider.name}...`),
          );
        }
      } catch (error) {
        console.error(chalk.red(getErrorMessage(error)));
        process.exitCode = 1;
      }
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
  .version("0.1.0");

program
  .command("uninstall")
  .description("remove ai-commit-helper from this machine")
  .action(async () => {
    await runUninstall();
  });

program
  .command("config")
  .description("manage ai-commit-helper configuration")
  .command("set <key> <value>")
  .description("set a configuration value")
  .action(async (key: string, value: string) => {
    await runConfigSet(key, value);
  });

program
  .option("--auto", "stage all changes and infer the goal without prompting")
  .option("--no-auto-stage", "do not run git add . automatically with --auto")
  .option(
    "--style-commits <n>",
    "number of recent commit messages to use as a style guide",
  )
  .option("--no-style-match", "do not match generated commit messages to recent commits")
  .option("--pr", "generate a markdown pull request description")
  .option("--show-diff", "print a preview of the staged diff")
  .option(
    "--provider <provider>",
    "AI provider to use: codex or openai. Defaults to automatic detection.",
    "auto",
  )
  .action(async (options: CliOptions) => {
    await run(options);
  });

program.parse();
