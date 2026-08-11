import { diffPreviewLength } from "../core/constants.js";
import type { OutputMode } from "../core/types.js";

export function previewDiff(diff: string): string {
  return diff.length > diffPreviewLength
    ? `${diff.slice(0, diffPreviewLength)}\n...`
    : diff;
}

function buildSummaryPrompt(
  stagedDiff: string,
  userGoal?: string,
  recentCommitMessages: string[] = [],
  includeChangelog = false,
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
  const outputStructure = includeChangelog
    ? `Commit message:
<style-matched commit title>

<optional style-matched body when the repository's recent commits use one>

Changelog:
<user-facing changelog bullets>`
    : `Commit message:
<style-matched commit title>

<optional style-matched body when the repository's recent commits use one>`;
  const changelogRules = includeChangelog
    ? `Changelog rules:
- Include all meaningful user-facing changes.
- The changelog can include more than 3-4 items when the diff warrants it.
- Do not include purely internal refactors unless they affect user behavior.
- Use clear user-facing wording.

`
    : "Do not include a Changelog section.\n\n";

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

PR title:
<short, descriptive pull request title>

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

export function buildGenerationPrompt(
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
  recentCommitMessages: string[] = [],
  includeChangelog = false,
): string {
  return mode === "pr"
    ? buildPrPrompt(stagedDiff, userGoal)
    : buildSummaryPrompt(
        stagedDiff,
        userGoal,
        recentCommitMessages,
        includeChangelog,
      );
}
