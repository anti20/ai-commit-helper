import type { UsageStats } from "../core/types.js";

function readNumericUsageField(
  usage: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = usage[key];
  return typeof value === "number" ? value : undefined;
}

export function extractUsageStats(response: unknown): UsageStats | undefined {
  if (
    typeof response !== "object" ||
    response === null ||
    !("usage" in response) ||
    typeof response.usage !== "object" ||
    response.usage === null
  ) {
    return undefined;
  }

  const usage = response.usage as Record<string, unknown>;
  const inputTokens =
    readNumericUsageField(usage, "input_tokens") ??
    readNumericUsageField(usage, "prompt_tokens");
  const outputTokens =
    readNumericUsageField(usage, "output_tokens") ??
    readNumericUsageField(usage, "completion_tokens");
  const totalTokens = readNumericUsageField(usage, "total_tokens");

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  const usageStats: UsageStats = {};

  if (inputTokens !== undefined) {
    usageStats.inputTokens = inputTokens;
  }

  if (outputTokens !== undefined) {
    usageStats.outputTokens = outputTokens;
  }

  if (totalTokens !== undefined) {
    usageStats.totalTokens = totalTokens;
  }

  return usageStats;
}

export function formatUsageStats(usage: UsageStats): string | null {
  const parts: string[] = [];

  if (usage.inputTokens !== undefined) {
    parts.push(`input ${usage.inputTokens}`);
  }

  if (usage.outputTokens !== undefined) {
    parts.push(`output ${usage.outputTokens}`);
  }

  if (usage.totalTokens !== undefined) {
    parts.push(`total ${usage.totalTokens}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `Token usage: ${parts.join(", ")}`;
}
