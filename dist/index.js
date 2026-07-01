#!/usr/bin/env node

// src/cli/program.ts
import { Command } from "commander";

// src/cli/commands.ts
import chalk3 from "chalk";
import ora from "ora";
import prompts3 from "prompts";

// src/config/user-config.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// src/core/constants.ts
import { homedir } from "node:os";
import { join } from "node:path";
var diffPreviewLength = 1500;
var generationTimeoutMs = 12e4;
var installerPathLine = 'export PATH="$HOME/.local/bin:$PATH"';
var userConfigPath = join(
  homedir(),
  ".config",
  "ai-commit-helper",
  "config.json"
);

// src/system/fs-utils.ts
import { constants } from "node:fs";
import { access } from "node:fs/promises";
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function isExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// src/config/user-config.ts
function parseStyleCommitCount(value) {
  const rawValue = value ?? "5";
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--style-commits must be a non-negative integer.");
  }
  return parsed;
}
function parseBooleanConfigValue(value) {
  const normalizedValue = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }
  throw new Error("styleMatch must be true or false.");
}
function parseUserConfig(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid JSON in ${userConfigPath}.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid config in ${userConfigPath}.`);
  }
  const rawConfig = parsed;
  const config = {};
  if (rawConfig.styleCommits !== void 0) {
    if (typeof rawConfig.styleCommits !== "number" || !Number.isInteger(rawConfig.styleCommits) || rawConfig.styleCommits < 0) {
      throw new Error("Config value styleCommits must be a non-negative integer.");
    }
    config.styleCommits = rawConfig.styleCommits;
  }
  if (rawConfig.styleMatch !== void 0) {
    if (typeof rawConfig.styleMatch !== "boolean") {
      throw new Error("Config value styleMatch must be true or false.");
    }
    config.styleMatch = rawConfig.styleMatch;
  }
  return config;
}
async function readUserConfig() {
  if (!await pathExists(userConfigPath)) {
    return {};
  }
  return parseUserConfig(await readFile(userConfigPath, "utf8"));
}
async function writeUserConfig(config) {
  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, `${JSON.stringify(config, null, 2)}
`, "utf8");
}
function resolveStyleCommitCount(options, config) {
  if (options.styleMatch === false) {
    return 0;
  }
  if (options.styleCommits !== void 0) {
    return parseStyleCommitCount(options.styleCommits);
  }
  if (config.styleMatch === false) {
    return 0;
  }
  return config.styleCommits ?? 5;
}

// src/core/errors.ts
function getErrorMessage(error) {
  if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" && error.stderr.trim().length > 0) {
    return error.stderr.trim();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// src/ai/generate.ts
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile as readFile2, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";

// src/ai/prompts.ts
function previewDiff(diff) {
  return diff.length > diffPreviewLength ? `${diff.slice(0, diffPreviewLength)}
...` : diff;
}
function buildSummaryPrompt(stagedDiff, userGoal, recentCommitMessages = [], includeChangelog = false) {
  const goalSection = userGoal ? `User goal:
${userGoal}

Use the user goal as important context. If the staged diff appears to contradict the user goal, mention that mismatch in the generated output.

` : "User goal:\nNot provided.\n\n";
  const commitStyleSection = recentCommitMessages.length > 0 ? `Recent commit messages to match stylistically:
${recentCommitMessages.map((message, index) => `${index + 1}. ${message}`).join("\n\n")}

Use these recent commit messages as the primary style guide for the new commit message. Match their format, casing, punctuation, level of detail, language, and whether they use a body. If the recent commits consistently use conventional commit format, use it too. If they do not, do not force conventional commit format.

` : `Recent commit messages to match stylistically:
Not available.

`;
  const outputStructure = includeChangelog ? `Commit message:
<style-matched commit title>

<optional style-matched body when the repository's recent commits use one>

Changelog:
<user-facing changelog bullets>` : `Commit message:
<style-matched commit title>

<optional style-matched body when the repository's recent commits use one>`;
  const changelogRules = includeChangelog ? `Changelog rules:
- Include all meaningful user-facing changes.
- The changelog can include more than 3-4 items when the diff warrants it.
- Do not include purely internal refactors unless they affect user behavior.
- Use clear user-facing wording.

` : "Do not include a Changelog section.\n\n";
  return `You are generating human-readable Git change summaries.

Do not modify files.
Do not run commands.
Return text only.
Keep the output short and easy to copy.

Use the staged git diff and optional user goal below to generate exactly this structured output:

${outputStructure}

Commit message rules:
- Match the style of the recent commit messages below.
- The first line must be a short title.
- Summarize the overall change, not just the first or most obvious change.
- If multiple major changes exist, use a broader title.
- A multi-line commit message is allowed.
- Add a commit body only when it fits the recent commit style and there are multiple meaningful changes.
- When adding a body, follow the recent commit style and include only the top 3-4 most important changes.
- Do not include every tiny change in the commit body.

${changelogRules}
Do not include a PR description.
Do not include testing notes.

${commitStyleSection}${goalSection}Staged git diff:
\`\`\`diff
${stagedDiff}
\`\`\``;
}
function buildPrPrompt(stagedDiff, userGoal) {
  const goalSection = userGoal ? `User goal:
${userGoal}

Use the user goal as important context. If the staged diff appears to contradict the user goal, mention that mismatch in the generated output.

` : "User goal:\nNot provided.\n\n";
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
function buildGenerationPrompt(mode, stagedDiff, userGoal, recentCommitMessages = [], includeChangelog = false) {
  return mode === "pr" ? buildPrPrompt(stagedDiff, userGoal) : buildSummaryPrompt(
    stagedDiff,
    userGoal,
    recentCommitMessages,
    includeChangelog
  );
}

// src/ai/usage.ts
function readNumericUsageField(usage, key) {
  const value = usage[key];
  return typeof value === "number" ? value : void 0;
}
function extractUsageStats(response) {
  if (typeof response !== "object" || response === null || !("usage" in response) || typeof response.usage !== "object" || response.usage === null) {
    return void 0;
  }
  const usage = response.usage;
  const inputTokens = readNumericUsageField(usage, "input_tokens") ?? readNumericUsageField(usage, "prompt_tokens");
  const outputTokens = readNumericUsageField(usage, "output_tokens") ?? readNumericUsageField(usage, "completion_tokens");
  const totalTokens = readNumericUsageField(usage, "total_tokens");
  if (inputTokens === void 0 && outputTokens === void 0 && totalTokens === void 0) {
    return void 0;
  }
  const usageStats = {};
  if (inputTokens !== void 0) {
    usageStats.inputTokens = inputTokens;
  }
  if (outputTokens !== void 0) {
    usageStats.outputTokens = outputTokens;
  }
  if (totalTokens !== void 0) {
    usageStats.totalTokens = totalTokens;
  }
  return usageStats;
}
function formatUsageStats(usage) {
  const parts = [];
  if (usage.inputTokens !== void 0) {
    parts.push(`input ${usage.inputTokens}`);
  }
  if (usage.outputTokens !== void 0) {
    parts.push(`output ${usage.outputTokens}`);
  }
  if (usage.totalTokens !== void 0) {
    parts.push(`total ${usage.totalTokens}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `Token usage: ${parts.join(", ")}`;
}

// src/ai/generate.ts
async function generateWithCodex(codexPath, mode, stagedDiff, userGoal, recentCommitMessages = [], includeChangelog = false) {
  const prompt = buildGenerationPrompt(
    mode,
    stagedDiff,
    userGoal,
    recentCommitMessages,
    includeChangelog
  );
  const outputPath = join2(
    tmpdir(),
    `ai-commit-helper-codex-${randomUUID()}.txt`
  );
  try {
    const args = buildCodexExecArgs(prompt, outputPath);
    let result;
    try {
      result = await runCodexExec(codexPath, args);
    } catch (error) {
      if (!isCodexConfigLoadError(error)) {
        throw error;
      }
      result = await runCodexExec(
        codexPath,
        buildCodexExecArgs(prompt, outputPath, {
          ignoreUserConfig: true
        })
      );
    }
    const { stdout, stderr } = result;
    const outputFile = await readFile2(outputPath, "utf8").catch(() => "");
    const output = outputFile.trim() || stdout.trim();
    if (output.length === 0) {
      const details = stderr.trim() || "Codex returned empty output.";
      throw new Error(details);
    }
    return {
      text: output
    };
  } finally {
    await unlink(outputPath).catch(() => void 0);
  }
}
function buildCodexExecArgs(prompt, outputPath, options = {}) {
  const model = process.env.AI_COMMIT_HELPER_CODEX_MODEL ?? "gpt-5.5";
  return [
    "exec",
    ...options.ignoreUserConfig ? ["--ignore-user-config"] : [],
    "-m",
    model,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "--output-last-message",
    outputPath,
    prompt
  ];
}
function isCodexConfigLoadError(error) {
  return getErrorMessage(error).includes("Error loading config.toml");
}
function extractOpenAiText(response) {
  if (typeof response === "object" && response !== null && "output_text" in response && typeof response.output_text === "string") {
    return response.output_text.trim();
  }
  if (typeof response === "object" && response !== null && "output" in response && Array.isArray(response.output)) {
    const textParts = [];
    for (const item of response.output) {
      if (typeof item === "object" && item !== null && "content" in item && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content === "object" && content !== null && "text" in content && typeof content.text === "string") {
            textParts.push(content.text);
          }
        }
      }
    }
    return textParts.join("\n").trim();
  }
  return "";
}
async function generateWithOpenAi(apiKey, mode, stagedDiff, userGoal, recentCommitMessages = [], includeChangelog = false) {
  const prompt = buildGenerationPrompt(
    mode,
    stagedDiff,
    userGoal,
    recentCommitMessages,
    includeChangelog
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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: prompt
      }),
      signal: controller.signal
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof responseBody === "object" && responseBody !== null && "error" in responseBody && typeof responseBody.error === "object" && responseBody.error !== null && "message" in responseBody.error && typeof responseBody.error.message === "string" ? responseBody.error.message : response.statusText;
      throw new Error(`OpenAI API request failed: ${message}`);
    }
    const output = extractOpenAiText(responseBody);
    if (output.length === 0) {
      throw new Error("OpenAI returned empty output.");
    }
    const usage = extractUsageStats(responseBody);
    return usage ? {
      text: output,
      usage
    } : {
      text: output
    };
  } finally {
    clearTimeout(timeout);
  }
}
function runCodexExec(codexPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, generationTimeoutMs);
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
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
        reject(
          new Error(`Codex timed out after ${generationTimeoutMs / 1e3} seconds.`)
        );
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
async function generateSummary(provider, mode, stagedDiff, userGoal, recentCommitMessages = [], includeChangelog = false) {
  if (provider.name === "codex") {
    return generateWithCodex(
      provider.codexPath,
      mode,
      stagedDiff,
      userGoal,
      recentCommitMessages,
      includeChangelog
    );
  }
  if (provider.name === "openai") {
    return generateWithOpenAi(
      provider.apiKey,
      mode,
      stagedDiff,
      userGoal,
      recentCommitMessages,
      includeChangelog
    );
  }
  throw new Error(`Unsupported AI provider: ${provider}.`);
}

// src/system/exec.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);

// src/git/client.ts
async function runGit(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout;
}
async function isInsideGitRepository() {
  try {
    const output = await runGit(["rev-parse", "--is-inside-work-tree"]);
    return output.trim() === "true";
  } catch {
    return false;
  }
}
async function readStagedDiff() {
  return runGit(["diff", "--staged"]);
}
async function readCurrentBranchLabel() {
  const branchName = (await runGit(["branch", "--show-current"])).trim();
  if (branchName.length > 0) {
    return branchName;
  }
  const shortHead = (await runGit(["rev-parse", "--short", "HEAD"])).trim();
  return `detached HEAD ${shortHead}`;
}
async function stageAllChanges() {
  await runGit(["add", "."]);
}
async function readAutoStageCandidateFiles() {
  const status = await runGit(["status", "--short", "--", "."]);
  return status.split("\n").map((line) => line.trimEnd()).filter((line) => line.length > 0).filter((line) => {
    if (line.startsWith("?? ")) {
      return true;
    }
    if (line.startsWith("!! ")) {
      return false;
    }
    return line.length > 1 && line[1] !== " ";
  }).map((line) => line.slice(3));
}
async function readRecentCommitMessages(limit = 5) {
  if (limit <= 0) {
    return [];
  }
  try {
    const output = await runGit(["log", `-${limit}`, "--format=%B%x1e"]);
    return output.split("").map((message) => message.trim()).filter((message) => message.length > 0);
  } catch {
    return [];
  }
}

// src/workflows/commit-actions.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { spawn as spawn3 } from "node:child_process";
import { readFile as readFile3, unlink as unlink2, writeFile as writeFile2 } from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join3 } from "node:path";
import chalk2 from "chalk";
import prompts from "prompts";

// src/system/clipboard.ts
import { spawn as spawn2 } from "node:child_process";
async function copyToClipboard(text) {
  await new Promise((resolve, reject) => {
    const child = spawn2("pbcopy", {
      stdio: ["pipe", "ignore", "pipe"]
    });
    const stderrChunks = [];
    child.stderr.on("data", (chunk) => {
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

// src/ui/output.ts
import chalk from "chalk";
function printAutoStagePreview(files) {
  if (files.length === 0) {
    console.log(chalk.cyan("No unstaged files to stage with git add ."));
    return;
  }
  console.log(
    chalk.green(
      `Staged ${files.length} file${files.length === 1 ? "" : "s"} with git add .:`
    )
  );
  for (const file of files) {
    console.log(`  ${file}`);
  }
}
function printGeneratedSummary(summary) {
  console.log();
  console.log(chalk.bold("Generated output"));
  console.log("=".repeat("Generated output".length));
  console.log(summary.trim());
}
function printUsageStats(usage) {
  if (!usage) {
    return;
  }
  const formattedUsage = formatUsageStats(usage);
  if (!formattedUsage) {
    return;
  }
  console.log();
  console.log(chalk.dim(formattedUsage));
}

// src/system/command-path.ts
async function findCommandInPath(command) {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `command -v ${command}`], {
      cwd: process.cwd()
    });
    const commandPath = stdout.trim().split("\n")[0];
    return commandPath && commandPath.length > 0 ? commandPath : null;
  } catch {
    return null;
  }
}

// src/workflows/commit-actions.ts
async function askForPrAction() {
  const response = await prompts({
    type: "select",
    name: "action",
    message: "What do you want to do?",
    choices: [
      {
        title: "Copy PR description",
        value: "copy"
      },
      {
        title: "Do nothing",
        value: "none"
      }
    ]
  });
  return response.action ?? null;
}
async function handlePrActions(prDescription) {
  const action = await askForPrAction();
  if (action === "copy") {
    await copyToClipboard(prDescription);
    console.log(chalk2.green("Copied PR description to clipboard."));
  }
}
function extractCommitMessage(generatedOutput) {
  const commitHeader = "Commit message:";
  const changelogHeader = "Changelog:";
  const commitStart = generatedOutput.indexOf(commitHeader);
  if (commitStart === -1) {
    throw new Error("Generated output did not include a Commit message section.");
  }
  const messageStart = commitStart + commitHeader.length;
  const changelogStart = generatedOutput.indexOf(changelogHeader, messageStart);
  const commitMessage = generatedOutput.slice(messageStart, changelogStart === -1 ? void 0 : changelogStart).trim();
  if (commitMessage.length === 0) {
    throw new Error("Generated commit message was empty.");
  }
  return commitMessage;
}
async function askForSummaryAction() {
  const response = await prompts({
    type: "select",
    name: "action",
    message: "What do you want to do?",
    choices: [
      {
        title: "Commit",
        value: "commit"
      },
      {
        title: "Commit and push",
        value: "commit-push"
      },
      {
        title: "Copy commit message",
        value: "copy"
      },
      {
        title: "Regenerate commit message",
        value: "regenerate"
      },
      {
        title: "Edit commit message",
        value: "edit"
      },
      {
        title: "Do nothing",
        value: "none"
      }
    ]
  });
  return response.action ?? null;
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
async function findCommitMessageEditor() {
  if (process.env.VISUAL) {
    return process.env.VISUAL;
  }
  if (process.env.EDITOR) {
    return process.env.EDITOR;
  }
  return await findCommandInPath("nano") ?? await findCommandInPath("vim") ?? await findCommandInPath("vi");
}
async function askForEditedCommitMessage(commitMessage) {
  const editor = await findCommitMessageEditor();
  if (!editor) {
    console.log(chalk2.yellow("No terminal editor found. Keeping previous message."));
    return commitMessage;
  }
  const messagePath = join3(
    tmpdir2(),
    `ai-commit-helper-edit-${randomUUID2()}.txt`
  );
  try {
    await writeFile2(messagePath, `${commitMessage.trim()}
`, "utf8");
    console.log(chalk2.cyan(`Opening commit message in ${editor}...`));
    await new Promise((resolve, reject) => {
      const child = spawn3("sh", ["-c", `${editor} ${shellQuote(messagePath)}`], {
        cwd: process.cwd(),
        stdio: "inherit"
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
    const editedCommitMessage = (await readFile3(messagePath, "utf8")).trim();
    if (editedCommitMessage.length === 0) {
      console.log(
        chalk2.yellow("Commit message cannot be empty. Keeping previous message.")
      );
      return commitMessage;
    }
    return editedCommitMessage;
  } finally {
    await unlink2(messagePath).catch(() => void 0);
  }
}
async function commitWithMessage(commitMessage) {
  const stagedDiff = await readStagedDiff();
  if (stagedDiff.trim().length === 0) {
    throw new Error("No staged changes found. Run git add . first.");
  }
  const messagePath = join3(
    tmpdir2(),
    `ai-commit-helper-message-${randomUUID2()}.txt`
  );
  try {
    await writeFile2(messagePath, `${commitMessage.trim()}
`, "utf8");
    await runGit(["commit", "-F", messagePath]);
  } finally {
    await unlink2(messagePath).catch(() => void 0);
  }
}
async function handleSummaryActions(generatedOutput, regenerateSummary) {
  let commitMessage = extractCommitMessage(generatedOutput);
  const branchLabel = await readCurrentBranchLabel();
  while (true) {
    console.log(
      chalk2.magentaBright(`Currently selected branch: ${branchLabel}`)
    );
    const action = await askForSummaryAction();
    if (!action || action === "none") {
      return;
    }
    if (action === "regenerate") {
      if (!regenerateSummary) {
        console.log(chalk2.yellow("Regenerate is not available."));
        continue;
      }
      generatedOutput = await regenerateSummary();
      printGeneratedSummary(generatedOutput);
      commitMessage = extractCommitMessage(generatedOutput);
      continue;
    }
    if (action === "edit") {
      commitMessage = await askForEditedCommitMessage(commitMessage);
      console.log(chalk2.green("Updated commit message:"));
      console.log(commitMessage);
      continue;
    }
    if (action === "copy") {
      await copyToClipboard(commitMessage);
      console.log(chalk2.green("Copied commit message to clipboard."));
      return;
    }
    await commitWithMessage(commitMessage);
    console.log(chalk2.green(`Created commit on ${branchLabel}.`));
    if (action === "commit-push") {
      console.log(chalk2.cyan(`Pushing ${branchLabel}...`));
      await runGit(["push"]);
      console.log(chalk2.green(`Pushed ${branchLabel}.`));
    }
    return;
  }
}

// src/ai/providers.ts
import { readdir } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join4 } from "node:path";
import prompts2 from "prompts";
function isProviderName(value) {
  return ["auto", "codex", "openai"].includes(value);
}
async function findCodexInPath() {
  return findCommandInPath("codex");
}
async function findCodexInVersionDirs(baseDir) {
  let entries;
  try {
    entries = await readdir(baseDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = join4(baseDir, entry, "bin", "codex");
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}
async function findCodexCli() {
  const pathCodex = await findCodexInPath();
  if (pathCodex) {
    return pathCodex;
  }
  const home = homedir2();
  const exactCandidates = [
    join4(home, ".local", "bin", "codex"),
    join4(home, ".npm-global", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ];
  for (const candidate of exactCandidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  const versionDirCandidates = [
    join4(home, ".nvm"),
    join4(home, ".fnm"),
    join4(home, ".local", "state", "fnm_multishells")
  ];
  for (const baseDir of versionDirCandidates) {
    const codexPath = await findCodexInVersionDirs(baseDir);
    if (codexPath) {
      return codexPath;
    }
  }
  return null;
}
async function detectAvailableProviders() {
  const providers = [];
  const codexPath = await findCodexCli();
  if (codexPath) {
    providers.push({
      name: "codex",
      codexPath
    });
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return providers;
}
function providerNames(providers) {
  return providers.map((provider) => provider.name).join(", ");
}
function missingProviderMessage(provider) {
  switch (provider) {
    case "codex":
      return "Provider 'codex' was requested but Codex CLI was not found.";
    case "openai":
      return "Provider 'openai' was requested but OPENAI_API_KEY is not set.";
  }
}
async function askForProvider(providers) {
  const response = await prompts2({
    type: "select",
    name: "provider",
    message: "Which AI provider do you want to use?",
    choices: providers.map((provider) => ({
      title: provider.name,
      value: provider.name
    }))
  });
  const selectedName = response.provider;
  return providers.find((provider) => provider.name === selectedName) ?? null;
}
async function selectAiProvider(requestedProvider, providers) {
  if (requestedProvider !== "auto") {
    const provider = providers.find(
      (availableProvider) => availableProvider.name === requestedProvider
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

// src/cli/commands.ts
async function askForUserGoal() {
  const response = await prompts3({
    type: "text",
    name: "goal",
    message: "What is the main goal of these changes?"
  });
  const goal = typeof response.goal === "string" ? response.goal.trim() : "";
  return goal.length > 0 ? goal : void 0;
}
async function runConfigSet(key, value) {
  try {
    const config = await readUserConfig();
    let savedValue;
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
    console.log(chalk3.green(`Saved ${key}=${savedValue} to ${userConfigPath}.`));
  } catch (error) {
    console.error(chalk3.red(getErrorMessage(error)));
    process.exitCode = 1;
  }
}
async function run(options) {
  if (!await isInsideGitRepository()) {
    console.error(chalk3.red("Error: current directory is not inside a Git repository."));
    process.exitCode = 1;
    return;
  }
  let userConfig;
  try {
    userConfig = await readUserConfig();
  } catch (error) {
    console.error(chalk3.red(getErrorMessage(error)));
    process.exitCode = 1;
    return;
  }
  try {
    const styleCommitCount = resolveStyleCommitCount(options, userConfig);
    if (options.auto && options.autoStage !== false) {
      const autoStageCandidateFiles = await readAutoStageCandidateFiles();
      await stageAllChanges();
      printAutoStagePreview(autoStageCandidateFiles);
    }
    const stagedDiff = await readStagedDiff();
    if (stagedDiff.trim().length === 0) {
      console.log(chalk3.yellow("No staged changes found."));
      return;
    }
    const availableProviders = await detectAvailableProviders();
    const requestedProvider = options.provider ?? "auto";
    if (!isProviderName(requestedProvider)) {
      console.error(
        chalk3.red(
          `Unsupported provider '${requestedProvider}'. Supported values: codex or openai.`
        )
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      chalk3.cyan(
        `Available AI providers: ${availableProviders.length > 0 ? providerNames(availableProviders) : "none"}`
      )
    );
    let aiProvider;
    try {
      aiProvider = await selectAiProvider(requestedProvider, availableProviders);
    } catch (error) {
      console.error(chalk3.red(getErrorMessage(error)));
      process.exitCode = 1;
      return;
    }
    if (!aiProvider) {
      console.error(
        chalk3.red(
          "No AI provider found. Install/login to Codex CLI or set OPENAI_API_KEY."
        )
      );
      process.exitCode = 1;
      return;
    }
    console.log(chalk3.green("Staged changes detected"));
    console.log(chalk3.cyan(`Using AI provider: ${aiProvider.name}`));
    if (aiProvider.name === "codex") {
      console.log(chalk3.cyan(`Using Codex CLI: ${aiProvider.codexPath}`));
    }
    if (options.showDiff) {
      console.log(previewDiff(stagedDiff));
    }
    try {
      const mode = options.pr ? "pr" : "summary";
      const userGoal = options.auto ? void 0 : await askForUserGoal();
      const includeChangelog = mode === "summary" && options.changelog === true;
      const recentCommitMessages = mode === "summary" ? await readRecentCommitMessages(styleCommitCount) : [];
      const generateOutput = async (message) => {
        const spinner = ora(message).start();
        try {
          const generatedResult = await generateSummary(
            aiProvider,
            mode,
            stagedDiff,
            userGoal,
            recentCommitMessages,
            includeChangelog
          );
          spinner.stop();
          printUsageStats(generatedResult.usage);
          return generatedResult.text;
        } catch (error) {
          spinner.stop();
          throw error;
        }
      };
      const generatedSummary = await generateOutput(
        `Generating output with ${aiProvider.name}...`
      );
      printGeneratedSummary(generatedSummary);
      try {
        if (mode === "pr") {
          await handlePrActions(generatedSummary);
        } else {
          await handleSummaryActions(
            generatedSummary,
            () => generateOutput(`Regenerating commit message with ${aiProvider.name}...`)
          );
        }
      } catch (error) {
        console.error(chalk3.red(getErrorMessage(error)));
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(
        chalk3.red(
          `Error generating summary with ${aiProvider.name}: ${getErrorMessage(error)}`
        )
      );
      process.exitCode = 1;
    }
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(chalk3.red(`Error reading staged changes: ${message}`));
    process.exitCode = 1;
  }
}

// src/workflows/uninstall.ts
import { lstat, readFile as readFile4, rm, unlink as unlink3, writeFile as writeFile3 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname2, join as join5 } from "node:path";
import { fileURLToPath } from "node:url";
import chalk4 from "chalk";
import prompts4 from "prompts";
async function askForUninstallConfirmation() {
  const response = await prompts4({
    type: "text",
    name: "confirm",
    message: "Remove ai-commit-helper from this machine? [y/N]"
  });
  const answer = typeof response.confirm === "string" ? response.confirm.trim() : "";
  return ["y", "yes"].includes(answer.toLowerCase());
}
async function readPackageName() {
  const packageJsonPath = join5(
    dirname2(fileURLToPath(import.meta.url)),
    "..",
    "package.json"
  );
  try {
    const packageJson = JSON.parse(await readFile4(packageJsonPath, "utf8"));
    return typeof packageJson.name === "string" && packageJson.name.length > 0 ? packageJson.name : null;
  } catch {
    return null;
  }
}
async function runNpmGlobalUninstall(packageName) {
  try {
    await execFileAsync("npm", ["ls", "-g", packageName, "--depth=0"], {
      maxBuffer: 10 * 1024 * 1024
    });
    await execFileAsync("npm", ["uninstall", "-g", packageName], {
      maxBuffer: 10 * 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}
async function uninstallNpmGlobalPackages() {
  const packageName = await readPackageName();
  const packageNames = Array.from(
    new Set(["ai-commit-helper", packageName].filter(Boolean))
  );
  let removed = false;
  for (const name of packageNames) {
    removed = await runNpmGlobalUninstall(name) || removed;
  }
  return removed;
}
async function removeKnownSymlink() {
  const symlinkPath = join5(homedir3(), ".local", "bin", "ai-commit-helper");
  try {
    const stats = await lstat(symlinkPath);
    if (!stats.isSymbolicLink()) {
      return false;
    }
    await unlink3(symlinkPath);
    return true;
  } catch {
    return false;
  }
}
async function removeInstallDirectory() {
  const installDirectory = join5(homedir3(), ".ai-commit-helper");
  if (!await pathExists(installDirectory)) {
    return false;
  }
  await rm(installDirectory, {
    recursive: true,
    force: true
  });
  return true;
}
async function removeInstallerPathLine(shellConfigPath) {
  if (!await pathExists(shellConfigPath)) {
    return false;
  }
  const contents = await readFile4(shellConfigPath, "utf8");
  const lines = contents.split("\n");
  const filteredLines = lines.filter((line) => line.trim() !== installerPathLine);
  if (filteredLines.length === lines.length) {
    return false;
  }
  await writeFile3(shellConfigPath, filteredLines.join("\n"), "utf8");
  console.log(chalk4.green(`Removed ai-commit-helper PATH line from ${shellConfigPath}.`));
  return true;
}
async function cleanupShellConfigs() {
  const shellConfigPaths = [
    join5(homedir3(), ".zshrc"),
    join5(homedir3(), ".bashrc")
  ];
  let updated = false;
  for (const shellConfigPath of shellConfigPaths) {
    updated = await removeInstallerPathLine(shellConfigPath) || updated;
  }
  return updated;
}
function printUninstallSummary(summary) {
  console.log();
  console.log(chalk4.bold("Uninstall summary"));
  console.log(`removed symlink: ${summary.removedSymlink ? "yes" : "no"}`);
  console.log(
    `removed install directory: ${summary.removedInstallDirectory ? "yes" : "no"}`
  );
  console.log(
    `removed npm global package: ${summary.removedNpmGlobalPackage ? "yes" : "no"}`
  );
  console.log(`updated shell config: ${summary.updatedShellConfig ? "yes" : "no"}`);
}
async function runUninstall() {
  if (!await askForUninstallConfirmation()) {
    console.log("Uninstall cancelled.");
    return;
  }
  const summary = {
    removedSymlink: await removeKnownSymlink(),
    removedInstallDirectory: await removeInstallDirectory(),
    removedNpmGlobalPackage: await uninstallNpmGlobalPackages(),
    updatedShellConfig: await cleanupShellConfigs()
  };
  if (!summary.removedSymlink && !summary.removedInstallDirectory && !summary.removedNpmGlobalPackage && !summary.updatedShellConfig) {
    console.log("No ai-commit-helper installation was found.");
  }
  printUninstallSummary(summary);
}

// src/cli/program.ts
function createProgram() {
  const program = new Command();
  program.name("ai-commit-helper").description("A CLI helper for creating commit messages.").version("0.1.0");
  program.command("uninstall").description("remove ai-commit-helper from this machine").action(async () => {
    await runUninstall();
  });
  program.command("config").description("manage ai-commit-helper configuration").command("set <key> <value>").description("set a configuration value").action(async (key, value) => {
    await runConfigSet(key, value);
  });
  program.option("--auto", "stage all changes and infer the goal without prompting").option("--no-auto-stage", "do not run git add . automatically with --auto").option(
    "--style-commits <n>",
    "number of recent commit messages to use as a style guide"
  ).option(
    "--no-style-match",
    "do not match generated commit messages to recent commits"
  ).option("--changelog", "include a changelog section in commit output").option("--pr", "generate a markdown pull request description").option("--show-diff", "print a preview of the staged diff").option(
    "--provider <provider>",
    "AI provider to use: codex or openai. Defaults to automatic detection.",
    "auto"
  ).action(async (options) => {
    await run(options);
  });
  return program;
}

// src/index.ts
createProgram().parse();
