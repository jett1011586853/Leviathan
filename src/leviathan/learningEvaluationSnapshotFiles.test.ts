import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  writeEvaluationSnapshotFromFiles,
} from '../learning/evaluationSnapshotFiles.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'
import type { PolarProxySpikeObservation } from '../learning/polarProxySpike.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-evaluation-snapshot-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value), 'utf8')
  return path
}

function heldOutRollout(
  id: string,
  finalOutcome: 'resolved' | 'unresolved' | 'regression' = 'resolved',
) {
  const rollout = createEmptyRolloutBundle({
    runId: `run_${id}`,
    sessionId: `session_${id}`,
    taskId: `task_${id}`,
    source: 'internal',
    split: 'held_out',
    timestamp: '2026-06-04T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:candidate/train_1',
    policyVersion: 'mimo-v2.5',
    userInstruction: `held out task ${id}`,
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  rollout.evaluation.final_outcome = finalOutcome
  rollout.evaluation.resolved_label = finalOutcome === 'resolved'
  rollout.evaluation.exit_codes = finalOutcome === 'resolved' ? [0] : [1]
  rollout.evaluation.test_commands = ['bun test src/leviathan']
  rollout.evaluation.test_outputs = ['1 failing test']
  rollout.failure.taxonomy = ['verification_failure.hidden_regression']
  rollout.failure.root_cause_summary = 'hidden held-out regression'
  rollout.code_changes.changed_files = ['src/example.ts']
  return rollout
}

function polarObservation(
  case_id: PolarProxySpikeObservation['case_id'],
  overrides: Partial<PolarProxySpikeObservation> = {},
): PolarProxySpikeObservation {
  return {
    case_id,
    captured_requests_count: 1,
    leviathan_model_requests_count: 1,
    request_response_pairs_complete: true,
    run_session_binding_complete: true,
    final_outcome_recorded: true,
    streaming_complete: true,
    tool_use_complete: true,
    trajectory_completeness: true,
    replay_fidelity: true,
    reward_binding_success: true,
    causal_chain_model_tool_diff_complete: true,
    test_artifacts_complete: true,
    ...overrides,
  }
}

describe('Leviathan evaluation snapshot files', () => {
  test('writes promotion snapshot from replay held-out governance and Polar files', () => {
    withTempDir(dir => {
      const replayPath = writeJson(dir, 'replay.json', [
        { passed: true },
        { status: 'completed', compare: { passed: true } },
      ])
      const heldOutPath = writeJson(dir, 'held-out.json', heldOutRollout('a'))
      const securityPath = writeJson(dir, 'security.json', { passed: true })
      const complexityPath = writeJson(dir, 'complexity.json', {
        passed: true,
        token_turn_cost_regression_pct: 0.04,
      })
      const targetSlicePath = writeJson(dir, 'target-slice.json', {
        before_success_rate: 0.5,
        after_success_rate: 0.7,
        min_delta: 0.05,
      })
      const regressionsPath = writeJson(dir, 'regressions.json', {
        p0_p1_count: 0,
      })
      const polarPath = writeJson(dir, 'polar.json', [
        polarObservation('case_a_no_tool'),
        polarObservation('case_b_file_read_write'),
        polarObservation('case_c_test_execution'),
      ])
      const outputPath = join(dir, 'promotion-snapshot.json')

      const result = writeEvaluationSnapshotFromFiles({
        output_path: outputPath,
        replay_results_path: replayPath,
        held_out_rollout_paths: [heldOutPath],
        security_scan_path: securityPath,
        complexity_budget_path: complexityPath,
        target_failure_slice_path: targetSlicePath,
        regressions_path: regressionsPath,
        polar_spike_observations_path: polarPath,
      })

      expect(result.output_path).toBe(outputPath)
      expect(result.snapshot).toEqual({
        replay_results: [{ passed: true }, { passed: true }],
        held_out_results: [
          {
            passed: true,
            task_id: 'task_a',
            split: 'held_out',
            final_outcome: 'resolved',
            resolved_label: true,
            taxonomy: ['verification_failure.hidden_regression'],
            exit_codes: [0],
            test_commands: ['bun test src/leviathan'],
            test_outputs_count: 1,
            changed_files: ['src/example.ts'],
            root_cause_summary: 'hidden held-out regression',
          },
        ],
        held_out_summary: {
          total: 1,
          passed: 1,
          failed: 0,
          regression_count: 0,
          unresolved_count: 0,
          unknown_count: 0,
          by_taxonomy: {
            'verification_failure.hidden_regression': 1,
          },
        },
        security_scan: { passed: true },
        complexity_budget: {
          passed: true,
          token_turn_cost_regression_pct: 0.04,
        },
        target_failure_slice: {
          before_success_rate: 0.5,
          after_success_rate: 0.7,
          min_delta: 0.05,
        },
        regressions: { p0_p1_count: 0 },
        polar_spike: { passed: true },
      })
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.snapshot,
      )
    })
  })

  test('keeps failed evidence visible when evaluation source files fail gates', () => {
    withTempDir(dir => {
      const replayPath = writeJson(dir, 'replay.json', [{ passed: false }])
      const heldOutPath = writeJson(
        dir,
        'held-out.json',
        heldOutRollout('failed', 'unresolved'),
      )
      const securityPath = writeJson(dir, 'security.json', { passed: false })
      const complexityPath = writeJson(dir, 'complexity.json', {
        passed: false,
        token_turn_cost_regression_pct: 0.2,
      })
      const targetSlicePath = writeJson(dir, 'target-slice.json', {
        before_success_rate: 0.5,
        after_success_rate: 0.51,
        min_delta: 0.05,
      })
      const regressionsPath = writeJson(dir, 'regressions.json', {
        p0_p1_count: 1,
      })
      const polarPath = writeJson(dir, 'polar.json', [
        polarObservation('case_a_no_tool', {
          captured_requests_count: 0,
        }),
      ])
      const outputPath = join(dir, 'promotion-snapshot.json')

      const result = writeEvaluationSnapshotFromFiles({
        output_path: outputPath,
        replay_results_path: replayPath,
        held_out_rollout_paths: [heldOutPath],
        security_scan_path: securityPath,
        complexity_budget_path: complexityPath,
        target_failure_slice_path: targetSlicePath,
        regressions_path: regressionsPath,
        polar_spike_observations_path: polarPath,
      })

      expect(result.snapshot.replay_results).toEqual([{ passed: false }])
      expect(result.snapshot.held_out_results).toEqual([
        {
          passed: false,
          task_id: 'task_failed',
          split: 'held_out',
          final_outcome: 'unresolved',
          resolved_label: false,
          taxonomy: ['verification_failure.hidden_regression'],
          exit_codes: [1],
          test_commands: ['bun test src/leviathan'],
          test_outputs_count: 1,
          changed_files: ['src/example.ts'],
          root_cause_summary: 'hidden held-out regression',
        },
      ])
      expect(result.snapshot.held_out_summary).toMatchObject({
        total: 1,
        passed: 0,
        failed: 1,
        unresolved_count: 1,
      })
      expect(result.snapshot.security_scan).toEqual({ passed: false })
      expect(result.snapshot.complexity_budget.passed).toBe(false)
      expect(result.snapshot.regressions).toEqual({ p0_p1_count: 1 })
      expect(result.snapshot.polar_spike).toEqual({ passed: false })
    })
  })

  test('preserves held-out regression diagnostics in the promotion snapshot', () => {
    withTempDir(dir => {
      const replayPath = writeJson(dir, 'replay.json', [{ passed: true }])
      const heldOutPath = writeJson(
        dir,
        'held-out-regression.json',
        heldOutRollout('regression', 'regression'),
      )
      const securityPath = writeJson(dir, 'security.json', { passed: true })
      const complexityPath = writeJson(dir, 'complexity.json', {
        passed: true,
        token_turn_cost_regression_pct: 0,
      })
      const targetSlicePath = writeJson(dir, 'target-slice.json', {
        before_success_rate: 0.5,
        after_success_rate: 0.7,
        min_delta: 0.05,
      })
      const regressionsPath = writeJson(dir, 'regressions.json', {
        p0_p1_count: 0,
      })
      const polarPath = writeJson(dir, 'polar.json', [
        polarObservation('case_a_no_tool'),
        polarObservation('case_b_file_read_write'),
        polarObservation('case_c_test_execution'),
      ])

      const result = writeEvaluationSnapshotFromFiles({
        output_path: join(dir, 'promotion-snapshot.json'),
        replay_results_path: replayPath,
        held_out_rollout_paths: [heldOutPath],
        security_scan_path: securityPath,
        complexity_budget_path: complexityPath,
        target_failure_slice_path: targetSlicePath,
        regressions_path: regressionsPath,
        polar_spike_observations_path: polarPath,
      })

      expect(result.snapshot.held_out_results).toEqual([
        {
          passed: false,
          task_id: 'task_regression',
          split: 'held_out',
          final_outcome: 'regression',
          resolved_label: false,
          taxonomy: ['verification_failure.hidden_regression'],
          exit_codes: [1],
          test_commands: ['bun test src/leviathan'],
          test_outputs_count: 1,
          changed_files: ['src/example.ts'],
          root_cause_summary: 'hidden held-out regression',
        },
      ])
      expect(result.snapshot.held_out_summary).toEqual({
        total: 1,
        passed: 0,
        failed: 1,
        regression_count: 1,
        unresolved_count: 0,
        unknown_count: 0,
        by_taxonomy: {
          'verification_failure.hidden_regression': 1,
        },
      })
    })
  })
})
