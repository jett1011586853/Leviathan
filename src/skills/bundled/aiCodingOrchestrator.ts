import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import {
  getSkillWhenToUse,
  parseSkillRuntimePolicy,
} from '../../utils/skillPolicy.js'
import { registerBundledSkill } from '../bundledSkills.js'
import {
  AI_CODING_SKILL_FILES,
  AI_CODING_SKILL_MD,
} from './aiCodingOrchestratorContent.js'

const REFERENCE_NAME = 'Leviathan 提问空间'
const REFERENCE_URL =
  'https://chatgpt.com/c/6a604c21-9eac-83ee-986c-7848328ece4f'
const NO_PROGRESS_ROUNDS = 3

const { frontmatter, content: SKILL_BODY } = parseFrontmatter(
  AI_CODING_SKILL_MD,
)

const DESCRIPTION =
  typeof frontmatter.description === 'string'
    ? frontmatter.description
    : 'Orchestrate permitted AI Coding tasks through staged analysis, implementation, evidence-based verification, and controlled submission.'

const WHEN_TO_USE =
  getSkillWhenToUse(frontmatter) ??
  'Triggers first: AI Coding, aicoding, permitted online-judge problems, hidden tests, or judge feedback.'

const SKILL_POLICY = parseSkillRuntimePolicy(
  frontmatter,
  'ai-coding-orchestrator',
)

function buildPrompt(args: string): string {
  const parts = [
    SKILL_BODY.trimStart(),
    `## Personal External Reference Configuration

- Reference name: ${REFERENCE_NAME}
- Reference URL: ${REFERENCE_URL}
- Consecutive ineffective rounds before escalation: ${NO_PROGRESS_ROUNDS}

When the no-progress gate is satisfied, pass this URL as \`url\` to \`BrowserDevTools\` action \`ask_chatgpt\`. Use only the browser's existing signed-in session. Never request, read, persist, inject, or replay exported cookies.`,
  ]

  if (args.trim()) {
    parts.push(`## User Request\n\n${args.trim()}`)
  }

  return parts.join('\n\n')
}

export function registerAiCodingOrchestratorSkill(): void {
  registerBundledSkill({
    name: 'ai-coding-orchestrator',
    aliases: ['aicoding', 'ai-coding'],
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    skillPolicy: SKILL_POLICY,
    allowedTools: [
      'Agent',
      'BrowserDevTools',
      'Read',
      'Grep',
      'Glob',
      'Edit',
      'Write',
      'Bash',
    ],
    argumentHint: '[problem, objective, or current failure]',
    userInvocable: true,
    files: AI_CODING_SKILL_FILES,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildPrompt(args) }]
    },
  })
}
