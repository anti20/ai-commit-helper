# AI Commit Helper

AI Commit Helper is a local AI-powered Git CLI tool. It reads staged Git changes and helps generate:

- conventional commit messages
- changelog entries
- pull request descriptions

It runs from your terminal inside any Git repository and uses `git diff --staged` as its input.

## Features

- Reads `git diff --staged` and ignores unstaged changes
- Generate clean commit messages from staged Git changes
- Support multi-line commit messages with concise bullet bodies
- Generate changelog entries for commit workflows
- Generate PR descriptions from staged changes with `--pr`
- Keep default output focused on commit message and changelog only
- Generate clean PR markdown with Summary, Changes, Why, Testing, and Risk sections
- Suggest PR testing steps from the diff without claiming tests were run
- Support Codex and OpenAI providers
- Prompt for provider selection when multiple providers are available
- Use automatic goal inference or manual goal input
- Automatically stage changes with `git add .` when using `--auto`
- Disable automatic staging with `--no-auto-stage`
- Treat an empty goal answer like automatic goal inference
- Show loading feedback while AI generation is running
- Commit directly from the generated commit message
- Commit and push in one step
- Edit generated commit messages before choosing the final action
- Copy commit messages or PR descriptions to the clipboard
- Preview the staged diff with `--show-diff`
- Hide the diff by default
- Handle missing providers and git errors with readable messages
- Install with one command using the smart installer
- Uninstall safely with `ai-commit-helper uninstall`

## Installation

Recommended one-time install:

```bash
curl -fsSL https://raw.githubusercontent.com/anti20/ai-commit-helper/main/install.sh | bash
```

The installer:

- clones the project into `~/.ai-commit-helper`
- installs dependencies and builds the CLI
- links the command to `~/.local/bin/ai-commit-helper`
- may ask to add `~/.local/bin` to your PATH

If PATH is added, new terminal windows should work automatically. In the current terminal, you may need to run one of these:

```bash
source ~/.zshrc
```

```bash
source ~/.bashrc
```

Verify the install:

```bash
ai-commit-helper --help
```

Requirements:

- Git
- Node.js 20 or newer
- npm
- Codex CLI or `OPENAI_API_KEY`

## Quick Start

From any Git repository:

```bash
ai-commit-helper --auto
```

The CLI generates commit-focused output:

- `Commit message`
- `Changelog`

Then it asks what to do:

- `Commit`
- `Commit and push`
- `Copy commit message`
- `Edit commit message`
- `Do nothing`

When editing a commit message, the current message opens as one editable text
buffer in your terminal editor before choosing the final action.

## Usage

Run with a goal prompt:

```bash
ai-commit-helper
```

Skip the goal prompt and infer intent from the staged diff:

```bash
ai-commit-helper --auto
```

Keep the current staged changes unchanged when using automatic goal inference:

```bash
ai-commit-helper --auto --no-auto-stage
```

Generate a PR description:

```bash
ai-commit-helper --pr --auto
```

Show a preview of the staged diff:

```bash
ai-commit-helper --show-diff --auto
```

Choose a provider explicitly:

```bash
ai-commit-helper --provider codex --auto
```

```bash
ai-commit-helper --provider openai --auto
```

Uninstall:

```bash
ai-commit-helper uninstall
```

## PR Workflow

Generate PR markdown:

```bash
ai-commit-helper --pr --auto
```

With `--auto`, the CLI stages changes with `git add .` before generating the PR
markdown.

PR mode generates only:

```markdown
## Summary
## Changes
## Why
## Testing
## Risk
```

Then it asks what to do:

- `Copy PR description`
- `Do nothing`

The Testing section contains suggested verification steps based on the diff. The tool does not run tests.

## Providers

Supported working providers:

- `codex`
- `openai`

Codex is used when the Codex CLI is available. OpenAI is available when `OPENAI_API_KEY` is set:

```bash
export OPENAI_API_KEY="your-api-key"
```

Do not commit API keys or files containing secrets.

Provider behavior:

- If `--provider` is passed, that provider is used.
- If exactly one provider is available, it is selected automatically.
- If multiple providers are available, the CLI asks which one to use.
- `--auto` runs `git add .` and skips the change-goal question. It does not skip provider selection.

## Options

```bash
ai-commit-helper [options]
```

### `--auto`

Runs `git add .`, skips the change-goal prompt, and lets the AI infer the goal
from the staged diff.

### `--no-auto-stage`

Disables the automatic `git add .` behavior when used with `--auto`.

### `--pr`

Generates a PR markdown description instead of commit message and changelog output.

### `--show-diff`

Prints a preview of `git diff --staged` before generation. The diff is hidden by default.

### `--provider <provider>`

Uses a specific provider.

Supported values:

- `codex`
- `openai`

Examples:

```bash
ai-commit-helper --provider codex --auto
ai-commit-helper --provider openai --auto
```

### `uninstall`

Runs the safe uninstall flow:

```bash
ai-commit-helper uninstall
```

## Uninstall

```bash
ai-commit-helper uninstall
```

The uninstall command asks for confirmation, then removes known install locations:

- `~/.ai-commit-helper`
- `~/.local/bin/ai-commit-helper`
- the global npm package, if installed

It also checks `~/.zshrc` and `~/.bashrc` and removes only this exact installer-added line:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

It does not remove `~/.local/bin`, arbitrary files from your PATH, or unrelated shell config content.

## Development

Clone and install dependencies:

```bash
git clone https://github.com/anti20/ai-commit-helper.git
cd ai-commit-helper
npm install
```

Run locally:

```bash
npm run dev -- --auto
npm run dev -- --pr --auto
```

Build:

```bash
npm run build
```

## Notes

- Only staged changes are used. Unstaged changes are ignored.
- The tool does not run tests.
- Generated text should be reviewed before committing, pushing, or opening a PR.
- Copy actions use `pbcopy`, so clipboard support is macOS-specific.
- Provider availability depends on local Codex CLI setup or `OPENAI_API_KEY`.
