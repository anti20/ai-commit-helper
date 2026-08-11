import { describe, expect, it } from "vitest";

import { buildCreateDraftPullRequestArgs } from "../src/github/pull-request.js";

describe("draft pull request creation", () => {
  it("builds GitHub CLI arguments with the generated title and description", () => {
    expect(
      buildCreateDraftPullRequestArgs(
        "Add draft PR creation",
        "## Summary\nAdds the workflow.",
      ),
    ).toEqual([
      "pr",
      "create",
      "--draft",
      "--title",
      "Add draft PR creation",
      "--body",
      "## Summary\nAdds the workflow.",
    ]);
  });
});
