import { execFileAsync } from "../system/exec.js";

export function buildCreateDraftPullRequestArgs(
  title: string,
  description: string,
): string[] {
  return ["pr", "create", "--draft", "--title", title, "--body", description];
}

export async function createDraftPullRequest(
  title: string,
  description: string,
): Promise<string> {
  let stdout: string;

  try {
    ({ stdout } = await execFileAsync(
      "gh",
      buildCreateDraftPullRequestArgs(title, description),
      {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024,
      },
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not create a draft GitHub pull request. Ensure gh is installed and authenticated. ${message}`,
    );
  }

  const url = stdout.trim();

  if (!url.startsWith("https://github.com/")) {
    throw new Error("GitHub CLI did not return a pull request URL.");
  }

  return url;
}
