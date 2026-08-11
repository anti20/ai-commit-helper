import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import prompts from "prompts";

import { copyToClipboard } from "../system/clipboard.js";
import { createDraftPullRequest } from "../github/pull-request.js";
import { readCurrentBranchLabel, readStagedDiff, runGit } from "../git/client.js";
import { printGeneratedSummary } from "../ui/output.js";
import { findCommandInPath } from "../system/command-path.js";
import type { PrAction, SummaryAction } from "../core/types.js";

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

export async function handlePrActions(prDescription: string): Promise<void> {
  const action = await askForPrAction();

  if (action === "copy") {
    await copyToClipboard(prDescription);
    console.log(chalk.green("Copied PR description to clipboard."));
  }
}

export function extractCommitMessage(generatedOutput: string): string {
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

export function extractPullRequestTitle(generatedOutput: string): string {
  const titleMatch = generatedOutput.match(/^PR title:\s*([^\n]+)$/m);
  const title = titleMatch?.[1]?.trim() ?? "";

  if (title.length === 0) {
    throw new Error("Generated output did not include a PR title.");
  }

  return title;
}

export function extractPullRequestDescription(generatedOutput: string): string {
  const descriptionStart = generatedOutput.indexOf("## Summary");

  if (descriptionStart === -1) {
    throw new Error("Generated output did not include a PR description.");
  }

  return generatedOutput.slice(descriptionStart).trim();
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
      console.log(
        chalk.yellow("Commit message cannot be empty. Keeping previous message."),
      );
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

export async function commitPushAndCreateDraftPullRequest(
  generatedOutput: string,
): Promise<string> {
  const title = extractPullRequestTitle(generatedOutput);
  const description = extractPullRequestDescription(generatedOutput);
  const branchLabel = await readCurrentBranchLabel();

  await commitWithMessage(title);
  console.log(chalk.green(`Created commit on ${branchLabel}.`));
  console.log(chalk.cyan(`Pushing ${branchLabel}...`));
  await runGit(["push", "-u", "origin", branchLabel]);
  console.log(chalk.green(`Pushed ${branchLabel}.`));

  return createDraftPullRequest(title, description);
}

export async function handleSummaryActions(
  generatedOutput: string,
  regenerateSummary?: () => Promise<string>,
): Promise<void> {
  let commitMessage = extractCommitMessage(generatedOutput);
  const branchLabel = await readCurrentBranchLabel();

  while (true) {
    console.log(
      chalk.magentaBright(`Currently selected branch: ${branchLabel}`),
    );

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
    console.log(chalk.green(`Created commit on ${branchLabel}.`));

    if (action === "commit-push") {
      console.log(chalk.cyan(`Pushing ${branchLabel}...`));
      await runGit(["push"]);
      console.log(chalk.green(`Pushed ${branchLabel}.`));
    }

    return;
  }
}
