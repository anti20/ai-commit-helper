# AI Commit Helper

AI Commit Helper is an AI-powered Git CLI tool for developers. It reads staged Git changes and helps generate useful:

- conventional commit messages
- changelog entries
- PR descriptions

It is a local CLI tool that runs from your terminal inside any Git repository. It works with the changes you have already staged with Git, so the input is always `git diff --staged`.

## What We Created

AI Commit Helper is designed for the moment after you have finished a change and before you commit it. You stage the files you want to include, run the CLI, and get copy-ready text based on the actual diff.

The tool can generate a short default output for commit workflows:

- `Commit message`
- `Changelog`

It can also generate a clean PR description with:

- `## Summary`
- `## Changes`
- `## Why`
- `## Testing`
- `## Risk`

After generation, the CLI can help with common next steps such as copying the commit message, creating a commit, committing and pushing, or copying the PR description.

## Features

- Reads `git diff --staged`
- Works from the terminal inside any Git repository
- Supports the Codex CLI provider
- Supports the OpenAI provider when `OPENAI_API_KEY` is set
- Asks which provider to use when multiple AI providers are available
- Supports `--auto` mode to skip the change-goal question
- Treats an empty goal answer the same as auto mode
- Supports `--pr` mode for PR markdown descriptions
- Supports `--show-diff` to preview the staged diff
- Hides the diff by default
- Shows loading feedback while AI generation is running
- Generates conventional commit messages
- Supports multi-line commit messages with concise bullet bodies
- Generates user-facing changelog entries
- Offers a default-mode action menu after generation
- Can create a commit with the generated commit message
- Can commit and push in one flow
- Can copy only the generated commit message
- Offers a minimal PR-mode action menu
- Can copy the full generated PR description

## Installation

Install globally from GitHub over HTTPS:

```bash
npm install -g git+https://github.com/anti20/ai-commit-helper.git
```

Verify the command is available:

```bash
ai-commit-helper --help
```

Basic usage:

```bash
ai-commit-helper --auto
ai-commit-helper --pr --auto
```

Requirements:

- Node.js 20 or newer
- Git
- Codex CLI or `OPENAI_API_KEY`

For local development, clone the repository:

```bash
git clone <repo-url>
cd ai-commit-helper
```

Install dependencies:

```bash
npm install
```

Build the TypeScript project:

```bash
npm run build
```

Link the CLI locally:

```bash
npm link
```

## Provider Setup

AI Commit Helper detects available AI providers locally.

Providers are the AI backends that can generate output from your staged diff. The runtime `Available AI providers` line only lists providers detected in your local environment.

Current generation providers:

- `codex`
- `openai`

Codex CLI is preferred when it is available in your environment. If you already use Codex locally, the helper can call the Codex CLI to generate output from your staged diff.

OpenAI can also be used when `OPENAI_API_KEY` is set:

```bash
export OPENAI_API_KEY="your-api-key"
```

Do not commit API keys, shell profiles containing secrets, `.env` files, or any other secret material to your repository.

Claude and Anthropic may appear as detected providers when their local setup or environment variables are present, but generation for those providers is partial/future support and is not wired yet.

When multiple providers are available, the CLI asks:

```text
Which AI provider do you want to use?
```

Passing `--provider` selects a provider explicitly. Passing `--auto` does not skip provider selection; it only skips the change-goal question.

## Usage

Stage the changes you want the tool to inspect:

```bash
git add README.md src/index.ts
```

Run the helper:

```bash
ai-commit-helper
```

During interactive usage, the CLI asks for the main goal of the change. If you submit an empty answer, it behaves like auto mode and lets the AI infer the goal from the staged diff.

### Modes

Modes change how the CLI behaves, but they are not providers and do not appear in the `Available AI providers` list.

- `--auto` skips the change-goal question.
- `--pr` generates only a PR markdown description.
- `--show-diff` prints a preview of the staged diff before generation.

### Auto Mode

Skip the change-goal question:

```bash
ai-commit-helper --auto
```

This still asks for a provider if multiple AI providers are available.

### PR Description Mode

Generate only a PR markdown description:

```bash
ai-commit-helper --pr
```

Or combine PR mode with auto mode:

```bash
ai-commit-helper --pr --auto
```

PR mode does not include separate commit message or changelog sections.

### Show Diff Mode

Preview the staged diff before generation:

```bash
ai-commit-helper --show-diff
```

The diff is hidden by default.

### Explicit Provider Mode

Use a specific provider:

```bash
ai-commit-helper --provider codex
```

```bash
ai-commit-helper --provider openai
```

Supported provider values are:

- `codex`
- `openai`

Claude and Anthropic are partial/future provider integrations. They may be detected in some environments, but generation is not wired yet.

### Commit And Push Workflow

After default output is generated, choose:

```text
Commit and push
```

The CLI writes the generated commit message to a temporary file, runs:

```bash
git commit -F <temp-file>
git push
```

The temporary file is removed after the commit attempt.

## Commands And Options

```bash
ai-commit-helper [options]
```

### `--auto`

Skips the change-goal question and lets the AI infer the goal from the staged diff.

This option does not skip provider selection when more than one provider is available.

### `--pr`

Generates only a PR markdown description.

Expected output sections:

```markdown
## Summary
## Changes
## Why
## Testing
## Risk
```

Testing guidance in PR mode is suggested from the diff. The tool does not run tests.

### `--show-diff`

Prints a preview of `git diff --staged` before generation.

Without this option, the diff is hidden.

### `--provider <provider>`

Selects a provider explicitly.

Examples:

```bash
ai-commit-helper --provider codex
ai-commit-helper --provider openai
```

If the requested provider is unavailable, the CLI exits with a readable error.

## Input And Output Examples

Example staged input:

```text
README.md
src/index.ts
```

The staged changes update the README and adjust CLI behavior in `src/index.ts`.

### Default Output

```text
Generated output
================
Commit message:
feat(cli): improve generated output workflow

- Add provider selection when multiple AI providers are available
- Add loading feedback during generation
- Separate commit summary and PR description modes

Changelog:
- Improved AI provider selection.
- Added loading feedback while AI output is generated.
- Simplified default output for commit workflows.
```

After default output, the CLI shows:

```text
What do you want to do?
```

Options:

- `Commit`
- `Commit and push`
- `Copy commit message`
- `Do nothing`

### PR Output

```markdown
## Summary
Improves the CLI workflow for generating commit-ready summaries and PR descriptions from staged changes.

## Changes
- Adds provider selection when multiple AI providers are detected.
- Adds loading feedback during AI generation.
- Separates default commit output from PR description output.
- Adds post-generation actions for copying generated text.

## Why
Developers need generated output that is easy to copy, review, and use directly in common Git and PR workflows.

## Testing
- Run `npm run build` to verify the TypeScript project compiles.
- Run `npm run dev -- --auto` with staged changes and verify default output contains only commit message and changelog sections.
- Run `npm run dev -- --pr --auto` and verify the PR output contains Summary, Changes, Why, Testing, and Risk sections.

## Risk
- Generated text still needs human review before committing or opening a PR.
- Provider availability depends on local Codex CLI or OpenAI API configuration.
```

After PR output, the CLI shows:

```text
What do you want to do?
```

Options:

- `Copy PR description`
- `Do nothing`

## Workflow Examples

### Normal Commit Flow

```bash
git add src/index.ts README.md
ai-commit-helper --auto
```

Review the generated commit message and changelog. Choose `Copy commit message` if you want to paste it into another tool, or choose `Commit` to create the commit directly.

### Commit And Push Flow

```bash
git add src/index.ts README.md
ai-commit-helper --auto
```

Choose `Commit and push`.

The CLI verifies staged changes still exist, writes the generated commit message to a temporary file, runs `git commit -F <temp-file>`, then runs `git push`.

### PR Description Flow

```bash
git add src/index.ts README.md
ai-commit-helper --pr --auto
```

Review the generated PR markdown. Choose `Copy PR description` to copy the full markdown output to the macOS clipboard, or choose `Do nothing` to exit cleanly.

## How It Works

The CLI follows this flow:

1. Checks that the current directory is inside a Git repository.
2. Reads staged changes with `git diff --staged`.
3. Exits early if no staged changes are found.
4. Detects available AI providers.
5. Uses the explicitly requested provider when `--provider` is passed.
6. Automatically uses the only available provider when exactly one provider is available.
7. Asks which provider to use when multiple providers are available.
8. Asks for the change goal unless `--auto` is passed.
9. Treats an empty goal as no goal, equivalent to auto mode.
10. Builds a mode-specific prompt from the staged diff and optional goal.
11. Generates output with the selected provider.
12. Prints the generated output.
13. Offers post-generation actions for the active mode.

Default mode generates only commit message and changelog output. PR mode generates only PR markdown output.

## Repository Layout

```text
.
├── README.md
├── package-lock.json
├── package.json
├── src
│   └── index.ts
└── tsconfig.json
```

Key files:

- `src/index.ts` contains the CLI implementation, provider detection, prompt generation, AI calls, and post-generation action menus.
- `package.json` defines the CLI binary, development scripts, dependencies, and Node.js engine requirement.
- `tsconfig.json` configures the TypeScript build.
- `README.md` documents installation, usage, workflows, examples, and limitations.

## Development

Run the CLI locally without linking:

```bash
npm run dev
```

Pass CLI options after `--`:

```bash
npm run dev -- --auto
npm run dev -- --pr --auto
npm run dev -- --auto --show-diff
```

Build the project:

```bash
npm run build
```

## README Maintenance

After making any meaningful project change, check whether `README.md` should be updated.

Update `README.md` when a change affects:

- installation
- usage
- CLI options
- command examples
- provider behavior
- generated output format
- workflows
- limitations
- examples

Do not update `README.md` for purely internal refactors that do not affect users.

When updating the README:

- keep examples accurate
- keep option descriptions in sync with the actual CLI
- update input/output examples if behavior changed
- do not add License, Code of Conduct, or Contributing sections

## Notes And Limitations

- The tool only works with staged Git changes.
- The tool reads `git diff --staged`; unstaged changes are ignored.
- The tool does not run tests.
- Testing content in PR output is suggested from the diff, not verified.
- Generated commit messages, changelog entries, and PR descriptions should be reviewed before use.
- Codex provider availability depends on the Codex CLI being installed and usable locally.
- OpenAI provider availability depends on `OPENAI_API_KEY` being set.
- Claude and Anthropic can be detected, but generation is not implemented for those providers yet.
- Clipboard copy actions use `pbcopy`, so they are macOS-specific.
