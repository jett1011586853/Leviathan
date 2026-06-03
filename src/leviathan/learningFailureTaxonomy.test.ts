import { describe, expect, test } from 'bun:test'

import {
  FAILURE_TAXONOMY,
  classifyFailureSignals,
  measureFailureTaxonomyCoverage,
} from '../learning/failureTaxonomy.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'

function rolloutWithTaxonomy(id: string, taxonomy: string[]) {
  const bundle = createEmptyRolloutBundle({
    runId: `run_${id}`,
    sessionId: `session_${id}`,
    taskId: `task_${id}`,
    source: 'internal',
    split: 'shadow',
    timestamp: '2026-06-03T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'classify this failure',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  bundle.failure.taxonomy = taxonomy
  return bundle
}

describe('Leviathan failure taxonomy registry', () => {
  test('contains the v1.0 high-level failure classes with target HL assets', () => {
    expect(FAILURE_TAXONOMY.map(entry => entry.code)).toEqual([
      'model_interaction_failure',
      'tool_choice_failure',
      'execution_environment_failure',
      'code_modification_failure',
      'verification_failure',
      'memory_context_failure',
      'recovery_control_failure',
      'security_governance_failure',
    ])
    expect(
      FAILURE_TAXONOMY.find(entry => entry.code === 'tool_choice_failure')
        ?.target_assets,
    ).toEqual(['tool_policy', 'prompt_policy'])
    expect(
      FAILURE_TAXONOMY.find(entry => entry.code === 'security_governance_failure')
        ?.target_assets,
    ).toEqual(['exporter', 'security_flags', 'benchmark_governance'])
  })

  test('classifies runtime signals into the preferred primary taxonomy', () => {
    expect(
      classifyFailureSignals({
        provider_mismatch: true,
        stream_truncated: true,
      })?.code,
    ).toBe('model_interaction_failure')
    expect(
      classifyFailureSignals({
        wrong_tool: true,
        bad_args: true,
      })?.code,
    ).toBe('tool_choice_failure')
    expect(
      classifyFailureSignals({
        secret_leak: true,
        benchmark_leak: true,
      })?.code,
    ).toBe('security_governance_failure')
  })

  test('measures 80 percent taxonomy coverage over rollout samples', () => {
    const result = measureFailureTaxonomyCoverage([
      rolloutWithTaxonomy('1', ['model_interaction_failure.provider_mismatch']),
      rolloutWithTaxonomy('2', ['tool_choice_failure.bad_args']),
      rolloutWithTaxonomy('3', ['verification_failure.flaky_tests']),
      rolloutWithTaxonomy('4', ['security_governance_failure.secret_leak']),
      rolloutWithTaxonomy('5', []),
    ])

    expect(result).toEqual({
      total: 5,
      classified: 4,
      coverage_ratio: 0.8,
      ready_at_80_percent: true,
      uncovered_run_ids: ['run_5'],
    })
  })

  test('treats unknown taxonomy codes as uncovered', () => {
    const result = measureFailureTaxonomyCoverage([
      rolloutWithTaxonomy('1', ['unknown_failure']),
      rolloutWithTaxonomy('2', ['tool_choice_failure.bad_args']),
    ])

    expect(result.ready_at_80_percent).toBe(false)
    expect(result.coverage_ratio).toBe(0.5)
    expect(result.uncovered_run_ids).toEqual(['run_1'])
  })
})
