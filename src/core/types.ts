export type ProviderName = "auto" | "codex" | "openai";

export type ProviderSelection =
  | {
      name: "codex";
      codexPath: string;
    }
  | {
      name: "openai";
      apiKey: string;
    };

export type CliOptions = {
  auto?: boolean;
  autoStage?: boolean;
  changelog?: boolean;
  pr?: boolean;
  showDiff?: boolean;
  provider?: string;
  styleCommits?: string;
  styleMatch?: boolean;
};

export type UserConfig = {
  styleCommits?: number;
  styleMatch?: boolean;
};

export type OutputMode = "summary" | "pr";
export type PrAction = "copy" | "none";

export type UsageStats = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type GeneratedResult = {
  text: string;
  usage?: UsageStats;
};

export type SummaryAction =
  | "commit"
  | "commit-push"
  | "copy"
  | "regenerate"
  | "edit"
  | "none";

export type UninstallSummary = {
  removedSymlink: boolean;
  removedInstallDirectory: boolean;
  removedNpmGlobalPackage: boolean;
  updatedShellConfig: boolean;
};
