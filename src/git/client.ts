import { execFileAsync } from "../system/exec.js";

export async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

export async function isInsideGitRepository(): Promise<boolean> {
  try {
    const output = await runGit(["rev-parse", "--is-inside-work-tree"]);
    return output.trim() === "true";
  } catch {
    return false;
  }
}

export async function readStagedDiff(): Promise<string> {
  return runGit(["diff", "--staged"]);
}

export async function readCurrentBranchLabel(): Promise<string> {
  const branchName = (await runGit(["branch", "--show-current"])).trim();

  if (branchName.length > 0) {
    return branchName;
  }

  const shortHead = (await runGit(["rev-parse", "--short", "HEAD"])).trim();
  return `detached HEAD ${shortHead}`;
}

export async function stageAllChanges(): Promise<void> {
  await runGit(["add", "."]);
}

export async function readAutoStageCandidateFiles(): Promise<string[]> {
  const status = await runGit(["status", "--short", "--", "."]);

  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (line.startsWith("?? ")) {
        return true;
      }

      if (line.startsWith("!! ")) {
        return false;
      }

      return line.length > 1 && line[1] !== " ";
    })
    .map((line) => line.slice(3));
}

export async function readRecentCommitMessages(limit = 5): Promise<string[]> {
  if (limit <= 0) {
    return [];
  }

  try {
    const output = await runGit(["log", `-${limit}`, "--format=%B%x1e"]);

    return output
      .split("\x1e")
      .map((message) => message.trim())
      .filter((message) => message.length > 0);
  } catch {
    return [];
  }
}
