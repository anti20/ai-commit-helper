import { describe, expect, it } from "vitest";

import {
  extractCommitMessage,
  extractPullRequestDescription,
  extractPullRequestTitle,
} from "../src/workflows/commit-actions.js";

describe("commit actions", () => {
  it("extracts commit messages without changelogs", () => {
    expect(
      extractCommitMessage(`Commit message:
feat: add prompt tests

- Cover prompt output
- Cover config parsing`),
    ).toBe(`feat: add prompt tests

- Cover prompt output
- Cover config parsing`);
  });

  it("extracts commit messages before changelog sections", () => {
    expect(
      extractCommitMessage(`Commit message:
fix: harden parser

Changelog:
- Improved commit message parsing`),
    ).toBe("fix: harden parser");
  });

  it("rejects missing or empty commit sections", () => {
    expect(() => extractCommitMessage("No commit here")).toThrow(
      "Generated output did not include a Commit message section.",
    );

    expect(() => extractCommitMessage("Commit message:\n\nChangelog:\n- item")).toThrow(
      "Generated commit message was empty.",
    );
  });
});

describe("pull request output", () => {
  const generatedPr = `PR title:
Add draft PR creation

## Summary
Adds an end-to-end draft PR workflow.

## Changes
- Adds GitHub CLI integration.`;

  it("extracts the generated PR title and markdown description", () => {
    expect(extractPullRequestTitle(generatedPr)).toBe("Add draft PR creation");
    expect(extractPullRequestDescription(generatedPr)).toBe(`## Summary
Adds an end-to-end draft PR workflow.

## Changes
- Adds GitHub CLI integration.`);
  });

  it("rejects missing PR titles and descriptions", () => {
    expect(() => extractPullRequestTitle("## Summary\nText")).toThrow(
      "Generated output did not include a PR title.",
    );
    expect(() => extractPullRequestDescription("PR title: Title")).toThrow(
      "Generated output did not include a PR description.",
    );
  });
});
