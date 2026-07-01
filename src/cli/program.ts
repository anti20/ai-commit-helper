import { Command } from "commander";

import { run, runConfigSet } from "./commands.js";
import type { CliOptions } from "../core/types.js";
import { runUninstall } from "../workflows/uninstall.js";

export function createProgram(): Command {
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
    .option("-a, --auto", "stage all changes and infer the goal without prompting")
    .option("--no-auto-stage", "do not run git add . automatically with --auto")
    .option(
      "--style-commits <n>",
      "number of recent commit messages to use as a style guide",
    )
    .option(
      "--no-style-match",
      "do not match generated commit messages to recent commits",
    )
    .option("--changelog", "include a changelog section in commit output")
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

  return program;
}
