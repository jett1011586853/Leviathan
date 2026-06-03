import { describe, expect, test } from 'bun:test'

import { deriveReplayPlan } from '../learning/replayPlan.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'

function createReplayableBundle() {
  return createEmptyRolloutBundle({
    runId: 'run_replay',
    sessionId: 'session_replay',
    taskId: 'task_replay',
    source: 'internal',
    split: 'shadow',
    timestamp: '2026-06-03T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'replay this task',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
}

describe('Leviathan replay plan scaffold', () => {
  test('derives a deterministic replay plan from a complete rollout bundle', () => {
    const plan = deriveReplayPlan(createReplayableBundle())

    expect(plan.ready).toBe(true)
    expect(plan.blockers).toEqual([])
    expect(plan.context).toEqual({
      repo: 'leviathan',
      base_commit: 'abc123',
      harness_version: 'git:abc123',
      heuristic_bundle_version: 'hb:initial',
      policy_version: 'mimo-v2.5',
      network_policy: 'restricted',
    })
    expect(plan.compare_policy).toEqual({
      tool_trace: 'name_order_status',
      patch: 'normalized_diff',
      tests: 'exit_code_and_output',
      failure_taxonomy: 'primary_class_exact',
      final_outcome: 'exact',
    })
  })

  test('reports explicit blockers for missing deterministic replay fields', () => {
    const bundle = createReplayableBundle()
    bundle.task.base_commit = ''
    bundle.runtime.network_policy = '' as never

    const plan = deriveReplayPlan(bundle)

    expect(plan.ready).toBe(false)
    expect(plan.blockers).toContain('task.base_commit')
    expect(plan.blockers).toContain('runtime.network_policy')
  })
})
