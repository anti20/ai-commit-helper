# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

`ai-commit-helper` is a Node.js 20+ TypeScript CLI that generates commit messages, changelog entries, and PR descriptions from staged Git changes. It uses `git diff --staged` as the source of truth and can call either the local Codex CLI or the OpenAI Responses API.

The package is ESM (`"type": "module"`). Source files live in `src/`, tests live in `tests/`, and production output is bundled into `dist/index.js`.

## Common Commands

Run these from the repository root:

```bash
npm test
npm run typecheck
npm run build
```

Useful local runs:

```bash
npm run dev -- --help
npm run dev -- --auto --no-auto-stage
npm run dev -- --pr --auto --no-auto-stage
npm run start -- --help
```

`npm run build` cleans and regenerates `dist/`. Do not edit files in `dist/` by hand.

## Code Layout

- `src/cli/`: Commander setup and top-level command orchestration.
- `src/workflows/`: interactive user workflows such as commit, push, PR copy, edit, and uninstall.
- `src/git/`: Git command wrappers. Keep Git side effects explicit and easy to reason about.
- `src/ai/`: provider detection, prompt construction, model calls, and usage parsing.
- `src/config/`: persistent user config parsing and validation.
- `src/system/`: filesystem, command lookup, process execution, and clipboard helpers.
- `src/ui/`: terminal output formatting.
- `src/core/`: shared types, constants, and error helpers.
- `tests/`: Vitest unit tests for pure logic and narrow behavior.

## Engineering Rules

- Prefer small, focused functions with explicit inputs and outputs.
- Keep side effects near workflow or system boundary modules. Pure parsing, validation, and prompt construction should stay easy to unit test.
- Use `execFile`-style argument arrays for shell commands. Avoid shell interpolation unless there is a strong reason.
- Do not add broad dependencies for small utilities that can be implemented clearly in TypeScript.
- Preserve the CLI's current behavior unless a change explicitly requires a user-facing behavior change.
- Keep terminal output concise and actionable. Use `chalk` consistently with existing output style.
- Do not commit secrets, API keys, local config, or generated credentials.

## Git and Safety Notes

- The tool is intentionally based on staged changes. Avoid accidentally changing behavior to include unstaged changes unless the requested feature says so.
- Be careful around `--auto`: it currently stages changes with `git add .` unless `--no-auto-stage` is used.
- Commit and push actions are real Git side effects. Tests should mock or isolate these paths rather than running them against the working repository.
- If adding new Git commands, put them behind `src/git/client.ts` unless they are tightly scoped to a workflow.

## AI Provider Notes

- Codex provider execution is in `src/ai/generate.ts` and uses a read-only, ephemeral Codex invocation.
- OpenAI provider execution uses the Responses API and reads `OPENAI_API_KEY`.
- Keep model names configurable through the existing environment variable pattern unless introducing a deliberate config feature.
- Prompt changes should include tests in `tests/prompts.test.ts` when they affect output structure or important instructions.
- Do not make prompts claim tests were run. PR descriptions should suggest verification steps, not invent results.

## Testing Expectations

Before finishing changes, run:

```bash
npm test
npm run typecheck
```

Run `npm run build` when changing package metadata, build scripts, CLI entrypoints, TypeScript compiler settings, or anything that could affect bundled output.

Add or update tests when changing:

- config parsing or precedence
- prompt structure
- generated output parsing
- Git status/diff handling
- workflow decisions that can be isolated without real Git side effects

## Style

- Use strict TypeScript and preserve `exactOptionalPropertyTypes`.
- Keep imports explicit and include `.js` extensions for local TypeScript imports, matching the NodeNext setup.
- Keep files ASCII unless existing content or a user-facing requirement justifies Unicode.
- Prefer clear error messages that tell the user what failed and what they can do next.
- Avoid broad refactors while implementing narrow feature requests.

## Release and Install Notes

- `install.sh` clones the GitHub repo, installs dependencies, builds the CLI, and links `~/.local/bin/ai-commit-helper`.
- `prepack` and `prepublishOnly` both run the build.
- The npm package includes only `dist`, `README.md`, and `package.json`.
- Generated `dist/` output should be produced by `npm run build`, not manually edited.
