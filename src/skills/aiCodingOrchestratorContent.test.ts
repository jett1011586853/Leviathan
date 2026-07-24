import { describe, expect, test } from 'bun:test'
import {
  AI_CODING_SKILL_FILES,
  AI_CODING_SKILL_MD,
} from './bundled/aiCodingOrchestratorContent.js'

describe('AI Coding orchestrator scoring policy', () => {
  test('directs the website AI while optimizing verified score under limits', () => {
    expect(AI_CODING_SKILL_MD).toContain(
      'Use the website-provided AI assistant as the primary delegated coding worker',
    )
    expect(AI_CODING_SKILL_MD).toContain(
      'maximize verified passed tests and effective score before the deadline',
    )
    expect(AI_CODING_SKILL_MD).toContain(
      'Never sacrifice known points for an unverified late rewrite',
    )
  })

  test('tracks scarce runs and preserves the best verified candidate', () => {
    const playbook =
      AI_CODING_SKILL_FILES['references/orchestration-playbook.md']
    const ledger =
      AI_CODING_SKILL_FILES['references/worker-contract-and-ledger.md']

    expect(playbook).toContain('Continuous Budget Controller')
    expect(playbook).toContain('SUBMISSION_RESERVE')
    expect(playbook).toContain('best_verified_partial_ready')
    expect(ledger).toContain('official_tests_remaining')
    expect(ledger).toContain('best_candidate')
  })

  test('uses local evidence recovery after repeated ineffective rounds', () => {
    const recovery =
      AI_CODING_SKILL_FILES[
        'references/local-recovery-and-compliance.md'
      ]

    expect(AI_CODING_SKILL_MD).toContain('Recover Locally')
    expect(recovery).toContain('Change The Diagnostic Axis')
    expect(recovery).toContain('Do not claim completion from confidence alone')
  })
})
