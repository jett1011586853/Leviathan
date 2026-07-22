import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import { registerBundledSkill } from '../bundledSkills.js'

const MISSING_REQUEST_MESSAGE = `Describe the skill you want to create or update.

Examples:
  /skill-creator create a skill for reviewing FastAPI endpoints
  /skill-creator create a repo-specific release checklist skill
  /skill-creator update the verifier skill to run the local smoke test`

const SKILL_CREATOR_PROMPT = `# Leviathan Skill Creator

You create and maintain reusable Leviathan skills.

## User Request

{{request}}

## Skill Locations

Use one of these locations:
- Project skill: \`.leviathan/skills/<skill-name>/SKILL.md\`
- Personal skill: \`~/.leviathan/skills/<skill-name>/SKILL.md\`

Prefer project skills for workflows that depend on this repository. Prefer personal skills for workflows the user wants available across repositories.

## Skill Shape

A skill is a directory named after the skill, with a required \`SKILL.md\` file:

\`\`\`text
<skill-name>/
  SKILL.md
  scripts/
  references/
  assets/
\`\`\`

Only create \`scripts/\`, \`references/\`, or \`assets/\` when they are actually useful.

## Frontmatter Template

\`\`\`markdown
---
name: skill-name
description: Use when the user wants ... Include the strongest trigger phrases and the workflow outcome.
allowed-tools: Read, Write, Edit
metadata:
  when_to_use: Use when ... Include representative user requests.
---

# Skill Title

Concise instructions for the reusable workflow.
\`\`\`

Required:
- \`name\`: lower-case letters, numbers, and hyphens only.
- \`description\`: the strongest trigger signal. Make it specific and include the situations where Leviathan should select the skill.

Optional:
- \`allowed-tools\`: minimum required tool permissions, using precise patterns such as \`Bash(gh:*)\` instead of broad \`Bash\`.
- \`metadata.when_to_use\`: richer trigger guidance and example user phrases for Leviathan. Keep the strongest trigger phrases at the beginning because listings are length-bounded before the full skill loads.
- \`metadata.leviathan.auto_trigger\`: optional high-confidence literal phrases for deterministic implicit invocation. Use \`phrases\` plus \`exclude\`; keep ordinary semantic discovery in the description.
- \`metadata.leviathan.lifecycle: task\`, \`reminder\`, and \`reminder_turns\`: optional for multi-turn workflows whose critical gates must remain active after invocation. Keep the reminder to one concise sentence.
- Keep provider-specific extensions inside \`metadata\`. Use only \`name\`, \`description\`, \`license\`, \`allowed-tools\`, and \`metadata\` at the top level so the Skill remains portable and standards-compatible.

## Workflow

1. Understand the request.
   - Identify the repeatable workflow, expected inputs, success criteria, and trigger phrases.
   - If the request is underspecified, ask at most three concise questions with \`${ASK_USER_QUESTION_TOOL_NAME}\`.

2. Choose the scope and path.
   - Use the requested location when provided.
   - If not provided, infer project vs personal from the workflow. Ask only if the choice materially changes behavior.
   - Never overwrite an existing skill before reading its current \`SKILL.md\`.

3. Design the skill.
   - Keep \`SKILL.md\` short enough to load quickly.
   - Put long examples, reference material, or checklists in \`references/\` and tell the skill to read them only when relevant.
   - Put deterministic helpers in \`scripts/\` instead of describing long command sequences in prose.
   - Put static media or templates in \`assets/\`.

4. Write or update files.
   - Create the skill directory if needed.
   - Preserve useful existing user content when updating.
   - Do not create README.md, INSTALLATION_GUIDE.md, QUICK_REFERENCE.md, CHANGELOG.md, or other extra documentation unless the user explicitly asks.

5. Validate.
   - Check that the frontmatter parses as YAML.
   - Check that \`name\` matches the directory name.
   - Check that \`description\` and \`metadata.when_to_use\` make the invocation trigger obvious.
   - For deterministic triggers, test at least one intended phrase, one exclusion, and one unrelated prompt.
   - Check that referenced files actually exist.
   - Run project tests only when the skill includes executable project code.

6. Report back.
   - State the exact \`SKILL.md\` path.
   - State how to invoke it, for example \`/<skill-name> [arguments]\`.
   - Mention any validation that was skipped and why.

## Quality Bar

- Optimize for reliable future invocation, not long documentation.
- A skill should teach Leviathan when to use it, what to do, and what success looks like.
- Prefer precise tool permissions over broad ones.
- Keep unrelated files untouched.
- Do not expose secrets in skill files.
- Do not mention or create legacy assistant directories or legacy product names.
`

function buildPrompt(request: string): string {
  const normalizedRequest =
    request.trim() ||
    'The user did not provide enough detail. Ask concise questions before creating files.'

  return SKILL_CREATOR_PROMPT.replace('{{request}}', normalizedRequest)
}

export function registerSkillCreatorSkill(): void {
  registerBundledSkill({
    name: 'skill-creator',
    aliases: ['skill-creater'],
    description:
      'Create or update reusable Leviathan skills under .leviathan/skills or ~/.leviathan/skills. Use when the user wants a new skill, reusable workflow, specialized procedure, or skill file maintenance.',
    whenToUse:
      'Use when the user wants to create, improve, package, or maintain a Leviathan skill. Examples: create a skill for reviewing APIs, add a testing workflow skill, update an existing skill prompt.',
    allowedTools: [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      ASK_USER_QUESTION_TOOL_NAME,
      'Bash(mkdir:*)',
    ],
    argumentHint: '<skill goal or update request>',
    userInvocable: true,
    async getPromptForCommand(args) {
      if (!args.trim()) {
        return [
          {
            type: 'text',
            text: `${MISSING_REQUEST_MESSAGE}\n\n${buildPrompt(args)}`,
          },
        ]
      }

      return [{ type: 'text', text: buildPrompt(args) }]
    },
  })
}
