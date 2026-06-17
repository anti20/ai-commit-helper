import chalk from "chalk";

import { formatUsageStats } from "../ai/usage.js";
import type { UsageStats } from "../core/types.js";

export function printAutoStagePreview(files: string[]): void {
  if (files.length === 0) {
    console.log(chalk.cyan("No unstaged files to stage with git add ."));
    return;
  }

  console.log(
    chalk.green(
      `Staged ${files.length} file${files.length === 1 ? "" : "s"} with git add .:`,
    ),
  );

  for (const file of files) {
    console.log(`  ${file}`);
  }
}

export function printGeneratedSummary(summary: string): void {
  console.log();
  console.log(chalk.bold("Generated output"));
  console.log("=".repeat("Generated output".length));
  console.log(summary.trim());
}

export function printUsageStats(usage?: UsageStats): void {
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
