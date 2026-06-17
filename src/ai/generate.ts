import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generationTimeoutMs } from "../core/constants.js";
import { getErrorMessage } from "../core/errors.js";
import { buildGenerationPrompt } from "./prompts.js";
import { extractUsageStats } from "./usage.js";
import type {
  GeneratedResult,
  OutputMode,
  ProviderSelection,
} from "../core/types.js";

async function generateWithCodex(
  codexPath: string,
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
  recentCommitMessages: string[] = [],
  includeChangelog = false,
): Promise<GeneratedResult> {
  const prompt = buildGenerationPrompt(
    mode,
    stagedDiff,
    userGoal,
    recentCommitMessages,
    includeChangelog,
  );
  const outputPath = join(
    tmpdir(),
    `ai-commit-helper-codex-${randomUUID()}.txt`,
  );

  try {
    const args = buildCodexExecArgs(prompt, outputPath);
    let result: { stdout: string; stderr: string };

    try {
      result = await runCodexExec(codexPath, args);
    } catch (error) {
      if (!isCodexConfigLoadError(error)) {
        throw error;
      }

      result = await runCodexExec(
        codexPath,
        buildCodexExecArgs(prompt, outputPath, {
          ignoreUserConfig: true,
        }),
      );
    }

    const { stdout, stderr } = result;
    const outputFile = await readFile(outputPath, "utf8").catch(() => "");
    const output = outputFile.trim() || stdout.trim();

    if (output.length === 0) {
      const details = stderr.trim() || "Codex returned empty output.";
      throw new Error(details);
    }

    return {
      text: output,
    };
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

function buildCodexExecArgs(
  prompt: string,
  outputPath: string,
  options: { ignoreUserConfig?: boolean } = {},
): string[] {
  const model = process.env.AI_COMMIT_HELPER_CODEX_MODEL ?? "gpt-5.5";

  return [
    "exec",
    ...(options.ignoreUserConfig ? ["--ignore-user-config"] : []),
    "-m",
    model,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "--output-last-message",
    outputPath,
    prompt,
  ];
}

function isCodexConfigLoadError(error: unknown): boolean {
  return getErrorMessage(error).includes("Error loading config.toml");
}

function extractOpenAiText(response: unknown): string {
  if (
    typeof response === "object" &&
    response !== null &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text.trim();
  }

  if (
    typeof response === "object" &&
    response !== null &&
    "output" in response &&
    Array.isArray(response.output)
  ) {
    const textParts: string[] = [];

    for (const item of response.output) {
      if (
        typeof item === "object" &&
        item !== null &&
        "content" in item &&
        Array.isArray(item.content)
      ) {
        for (const content of item.content) {
          if (
            typeof content === "object" &&
            content !== null &&
            "text" in content &&
            typeof content.text === "string"
          ) {
            textParts.push(content.text);
          }
        }
      }
    }

    return textParts.join("\n").trim();
  }

  return "";
}

async function generateWithOpenAi(
  apiKey: string,
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
  recentCommitMessages: string[] = [],
  includeChangelog = false,
): Promise<GeneratedResult> {
  const prompt = buildGenerationPrompt(
    mode,
    stagedDiff,
    userGoal,
    recentCommitMessages,
    includeChangelog,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, generationTimeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: prompt,
      }),
      signal: controller.signal,
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "error" in responseBody &&
        typeof responseBody.error === "object" &&
        responseBody.error !== null &&
        "message" in responseBody.error &&
        typeof responseBody.error.message === "string"
          ? responseBody.error.message
          : response.statusText;

      throw new Error(`OpenAI API request failed: ${message}`);
    }

    const output = extractOpenAiText(responseBody);

    if (output.length === 0) {
      throw new Error("OpenAI returned empty output.");
    }

    const usage = extractUsageStats(responseBody);

    return usage
      ? {
          text: output,
          usage,
        }
      : {
          text: output,
        };
  } finally {
    clearTimeout(timeout);
  }
}

function runCodexExec(
  codexPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(codexPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, generationTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (timedOut) {
        reject(
          new Error(`Codex timed out after ${generationTimeoutMs / 1000} seconds.`),
        );
        return;
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `Codex exited with code ${code}.`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export async function generateSummary(
  provider: ProviderSelection,
  mode: OutputMode,
  stagedDiff: string,
  userGoal?: string,
  recentCommitMessages: string[] = [],
  includeChangelog = false,
): Promise<GeneratedResult> {
  if (provider.name === "codex") {
    return generateWithCodex(
      provider.codexPath,
      mode,
      stagedDiff,
      userGoal,
      recentCommitMessages,
      includeChangelog,
    );
  }

  if (provider.name === "openai") {
    return generateWithOpenAi(
      provider.apiKey,
      mode,
      stagedDiff,
      userGoal,
      recentCommitMessages,
      includeChangelog,
    );
  }

  throw new Error(`Unsupported AI provider: ${provider satisfies never}.`);
}
