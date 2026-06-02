import { feature } from 'bun:bundle'
import type { Command } from '../commands.js'
import { maybeMarkProjectOnboardingComplete } from '../projectOnboardingState.js'
import { isEnvTruthy } from '../utils/envUtils.js'

const BASIC_INIT_PROMPT = `Analyze this codebase and create a minimal LEVIATHAN.md file for future Leviathan sessions in this repository.

Include only information that is difficult to infer by reading ordinary project files:
- Build, lint, test and single-test commands that differ from conventions.
- High-level architecture or workflow constraints that span multiple files.
- Required setup, environment variables, testing quirks and repository etiquette.

Do not add generic engineering advice, file listings or invented workflows. If LEVIATHAN.md already exists, propose focused improvements rather than overwriting it silently.

Prefix a new file with:

\`\`\`
# LEVIATHAN.md

This file provides guidance to Leviathan when working with code in this repository.
\`\`\``

const GUIDED_INIT_PROMPT = `Set up concise Leviathan instructions, and optionally reusable skills and hooks, for this repository.

## Phase 1: Select artifacts

Use AskUserQuestion to ask:
- Which instruction files to create: "Project LEVIATHAN.md", "Personal LEVIATHAN.local.md", or "Both".
- Whether to configure "Skills + hooks", "Skills only", "Hooks only", or "Neither, just instructions".

Project instructions are checked into source control. Personal instructions are private and should be ignored by version control.

## Phase 2: Inspect the repository

Survey manifest files, README files, build and CI configuration, existing LEVIATHAN.md and .leviathan/rules files, AGENTS.md, editor-agent rules and .mcp.json.

Identify:
- Non-obvious build, lint, test and format commands.
- Frameworks, package manager, repository structure and worktree usage.
- Rules or architectural choices that are not apparent from language defaults.
- Existing skills, hooks and instruction files that should be preserved.

## Phase 3: Confirm missing context

Ask only questions the repository cannot answer. Prepare a compact proposal of instruction notes, optional skills and optional hooks. Do not create an artifact category the user did not select.

## Phase 4: Write instructions

For project instructions, create or update LEVIATHAN.md. Include only non-obvious commands, required setup, testing quirks, architectural constraints and accepted preference notes.

Prefix a new project file with:

\`\`\`
# LEVIATHAN.md

This file provides guidance to Leviathan when working with code in this repository.
\`\`\`

For personal instructions, create LEVIATHAN.local.md and add it to .gitignore. Keep it short: user role, private local workflow details and communication preferences only.

For focused project rules, use .leviathan/rules/<topic>.md with paths frontmatter where a rule applies only to part of the repository.

## Phase 5: Optional skills and hooks

When skills were selected, place project skills under .leviathan/skills/<skill-name>/SKILL.md. Prefer skills for deliberate workflows such as verification or release checks.

When hooks were selected, use .leviathan/settings.json for shared configuration or .leviathan/settings.local.json for private configuration. Use hooks only for deterministic, fast actions such as formatting after an edit. Verify any configuration before reporting it as complete.

## Phase 6: Report

List the files written or changed and the key project-specific guidance included. Suggest only relevant next improvements and do not install external plugin catalogs automatically.`

const command = {
  type: 'prompt',
  name: 'init',
  get description() {
    return feature('NEW_INIT') &&
      (process.env.USER_TYPE === 'ant' ||
        isEnvTruthy(process.env.LEVIATHAN_CODE_NEW_INIT))
      ? 'Initialize LEVIATHAN.md file(s) and optional skills/hooks'
      : 'Initialize a LEVIATHAN.md file with codebase guidance'
  },
  contentLength: 0,
  progressMessage: 'analyzing your codebase',
  source: 'builtin',
  async getPromptForCommand() {
    maybeMarkProjectOnboardingComplete()

    return [
      {
        type: 'text',
        text:
          feature('NEW_INIT') &&
          (process.env.USER_TYPE === 'ant' ||
            isEnvTruthy(process.env.LEVIATHAN_CODE_NEW_INIT))
            ? GUIDED_INIT_PROMPT
            : BASIC_INIT_PROMPT,
      },
    ]
  },
} satisfies Command

export default command
