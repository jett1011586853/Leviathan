import { describe, expect, test } from 'bun:test'

import { compareReplayArtifacts } from '../learning/replayCompare.js'
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

  test('compares replay artifacts using normalized diff and exact outcome gates', () => {
    const golden = createReplayableBundle()
    golden.tool_events = [
      {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        input_redacted: { file: 'src/a.ts' },
        success: true,
        result_summary: 'ok',
      },
    ]
    golden.code_changes.diff = 'diff --git a/a.ts b/a.ts\n+ const answer = 42\n'
    golden.evaluation.exit_codes = [0]
    golden.evaluation.test_outputs = ['PASS']
    golden.evaluation.final_outcome = 'resolved'
    golden.failure.taxonomy = ['code_modification_failure.patch_quality']

    const replay = createReplayableBundle()
    replay.tool_events = structuredClone(golden.tool_events)
    replay.code_changes.diff =
      'diff --git a/a.ts b/a.ts\n+\tconst   answer = 42  \n'
    replay.evaluation.exit_codes = [0]
    replay.evaluation.test_outputs = ['PASS']
    replay.evaluation.final_outcome = 'resolved'
    replay.failure.taxonomy = ['code_modification_failure.other_detail']

    const result = compareReplayArtifacts(golden, replay)

    expect(result.passed).toBe(true)
    expect(result.mismatches).toEqual([])
    expect(result.scores).toEqual({
      tool_trace: 1,
      patch: 1,
      tests: 1,
      failure_taxonomy: 1,
      final_outcome: 1,
    })
  })

  test('reports replay artifact mismatches with actionable fields', () => {
    const golden = createReplayableBundle()
    golden.tool_events = [
      {
        tool_use_id: 'tool_1',
        tool_name: 'Read',
        input_redacted: {},
        success: true,
        result_summary: 'ok',
      },
    ]
    golden.evaluation.exit_codes = [0]
    golden.evaluation.test_outputs = ['PASS']
    golden.evaluation.final_outcome = 'resolved'
    golden.failure.taxonomy = ['verification_failure']

    const replay = createReplayableBundle()
    replay.tool_events = [
      {
        tool_use_id: 'tool_2',
        tool_name: 'Bash',
        input_redacted: {},
        success: false,
        result_summary: 'failed',
      },
    ]
    replay.evaluation.exit_codes = [1]
    replay.evaluation.test_outputs = ['FAIL']
    replay.evaluation.final_outcome = 'unresolved'
    replay.failure.taxonomy = ['tool_choice_failure']

    const result = compareReplayArtifacts(golden, replay)

    expect(result.passed).toBe(false)
    expect(result.mismatches).toEqual([
      'tool_trace',
      'tests',
      'failure_taxonomy',
      'final_outcome',
    ])
    expect(result.scores.tool_trace).toBe(0)
    expect(result.scores.tests).toBe(0)
  })
})
