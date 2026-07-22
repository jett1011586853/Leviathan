// Content for the bundled AI Coding orchestrator skill.
// Markdown files are inlined at build time through Bun's text loader.

import skillMd from './ai-coding-orchestrator/SKILL.md'
import orchestrationPlaybook from './ai-coding-orchestrator/references/orchestration-playbook.md'
import rescueAndCompliance from './ai-coding-orchestrator/references/rescue-and-compliance.md'
import workerContractAndLedger from './ai-coding-orchestrator/references/worker-contract-and-ledger.md'

export const AI_CODING_SKILL_MD: string = skillMd

export const AI_CODING_SKILL_FILES: Record<string, string> = {
  'references/orchestration-playbook.md': orchestrationPlaybook,
  'references/worker-contract-and-ledger.md': workerContractAndLedger,
  'references/rescue-and-compliance.md': rescueAndCompliance,
}
