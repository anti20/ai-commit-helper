import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";

import {
  parseBooleanConfigValue,
  parseStyleCommitCount,
  readUserConfig,
  resolveStyleCommitCount,
  writeUserConfig,
} from "../config/user-config.js";
import { userConfigPath } from "../core/constants.js";
import { getErrorMessage } from "../core/errors.js";
import { generateSummary } from "../ai/generate.js";
import { previewDiff } from "../ai/prompts.js";
import {
  isInsideGitRepository,
  readAutoStageCandidateFiles,
  readRecentCommitMessages,
  readStagedDiff,
  stageAllChanges,
} from "../git/client.js";
import {
  commitPushAndCreateDraftPullRequest,
  handlePrActions,
  handleSummaryActions,
} from "../workflows/commit-actions.js";
import {
  printAutoStagePreview,
  printGeneratedSummary,
  printUsageStats,
} from "../ui/output.js";
import {
  detectAvailableProviders,
  isProviderName,
  providerNames,
  selectAiProvider,
} from "../ai/providers.js";
import type { CliOptions, OutputMode } from "../core/types.js";

async function askForUserGoal(): Promise<string | undefined> {
  const response = await prompts({
    type: "text",
    name: "goal",
    message: "What is the main goal of these changes?",
  });

  const goal = typeof response.goal === "string" ? response.goal.trim() : "";
  return goal.length > 0 ? goal : undefined;
}

export async function runConfigSet(key: string, value: string): Promise<void> {
  try {
    const config = await readUserConfig();
    let savedValue: string;

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
    console.log(chalk.green(`Saved ${key}=${savedValue} to ${userConfigPath}.`));
  } catch (error) {
    console.error(chalk.red(getErrorMessage(error)));
    process.exitCode = 1;
  }
}

export async function run(options: CliOptions): Promise<void> {
  if (!(await isInsideGitRepository())) {
    console.error(chalk.red("Error: current directory is not inside a Git repository."));
    process.exitCode = 1;
    return;
  }

  let userConfig;

  try {
    userConfig = await readUserConfig();
  } catch (error) {
    console.error(chalk.red(getErrorMessage(error)));
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
      console.log(chalk.yellow("No staged changes found."));
      return;
    }

    const availableProviders = await detectAvailableProviders();
    const requestedProvider = options.provider ?? "auto";

    if (!isProviderName(requestedProvider)) {
      console.error(
        chalk.red(
          `Unsupported provider '${requestedProvider}'. Supported values: codex or openai.`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      chalk.cyan(
        `Available AI providers: ${
          availableProviders.length > 0 ? providerNames(availableProviders) : "none"
        }`,
      ),
    );

    let aiProvider;

    try {
      aiProvider = await selectAiProvider(requestedProvider, availableProviders);
    } catch (error) {
      console.error(chalk.red(getErrorMessage(error)));
      process.exitCode = 1;
      return;
    }

    if (!aiProvider) {
      console.error(
        chalk.red(
          "No AI provider found. Install/login to Codex CLI or set OPENAI_API_KEY.",
        ),
      );
      process.exitCode = 1;
      return;
    }

    console.log(chalk.green("Staged changes detected"));
    console.log(chalk.cyan(`Using AI provider: ${aiProvider.name}`));

    if (aiProvider.name === "codex") {
      console.log(chalk.cyan(`Using Codex CLI: ${aiProvider.codexPath}`));
    }

    if (options.showDiff) {
      console.log(previewDiff(stagedDiff));
    }

    try {
      const mode: OutputMode = options.pr || options.createPr ? "pr" : "summary";
      const userGoal = options.auto ? undefined : await askForUserGoal();
      const includeChangelog = mode === "summary" && options.changelog === true;
      const recentCommitMessages =
        mode === "summary" ? await readRecentCommitMessages(styleCommitCount) : [];
      const generateOutput = async (message: string): Promise<string> => {
        const spinner = ora(message).start();

        try {
          const generatedResult = await generateSummary(
            aiProvider,
            mode,
            stagedDiff,
            userGoal,
            recentCommitMessages,
            includeChangelog,
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
        `Generating output with ${aiProvider.name}...`,
      );

      printGeneratedSummary(generatedSummary);

      try {
        if (options.createPr) {
          const pullRequestUrl = await commitPushAndCreateDraftPullRequest(
            generatedSummary,
          );
          console.log(chalk.green(`Created draft pull request: ${pullRequestUrl}`));
        } else if (mode === "pr") {
          await handlePrActions(generatedSummary);
        } else {
          await handleSummaryActions(generatedSummary, () =>
            generateOutput(`Regenerating commit message with ${aiProvider.name}...`),
          );
        }
      } catch (error) {
        console.error(chalk.red(getErrorMessage(error)));
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(
        chalk.red(
          `Error generating summary with ${aiProvider.name}: ${getErrorMessage(error)}`,
        ),
      );
      process.exitCode = 1;
    }
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(chalk.red(`Error reading staged changes: ${message}`));
    process.exitCode = 1;
  }
}
