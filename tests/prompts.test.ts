import { describe, expect, it } from "vitest";

import { buildGenerationPrompt, previewDiff } from "../src/ai/prompts.js";

describe("prompt generation", () => {
  const diff = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+new`;

  it("builds commit prompts with style examples and optional changelog", () => {
    const prompt = buildGenerationPrompt(
      "summary",
      diff,
      "Improve the example",
      ["feat: add old example", "fix: correct example output"],
      true,
    );

    expect(prompt).toContain("Commit message:");
    expect(prompt).toContain("Changelog:");
    expect(prompt).toContain("Recent commit messages to match stylistically:");
    expect(prompt).toContain("1. feat: add old example");
    expect(prompt).toContain("User goal:\nImprove the example");
    expect(prompt).toContain("Staged git diff:");
    expect(prompt).toContain(diff);
    expect(prompt).not.toContain("Do not include a Changelog section.");
  });

  it("builds PR prompts without commit or changelog sections", () => {
    const prompt = buildGenerationPrompt("pr", diff);

    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Changes");
    expect(prompt).toContain("## Testing");
    expect(prompt).toContain("User goal:\nNot provided.");
    expect(prompt).toContain(diff);
    expect(prompt).toContain("Do not include separate Commit message or Changelog sections.");
  });

  it("returns short diff previews unchanged", () => {
    expect(previewDiff("small diff")).toBe("small diff");
  });
});
