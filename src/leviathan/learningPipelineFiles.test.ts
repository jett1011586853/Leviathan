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
  runLearningPipelineFromFiles,
} from '../learning/learningPipelineFiles.js'
import type { PolarProxySpikeObservation } from '../learning/polarProxySpike.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-learning-pipeline-'))
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

function rollout(
  id: string,
  split: 'shadow' | 'held_out',
  finalOutcome: 'resolved' | 'unresolved',
) {
  const bundle = createEmptyRolloutBundle({
    runId: `run_${id}`,
    sessionId: `session_${id}`,
    taskId: `task_${id}`,
    source: 'internal',
    split,
    timestamp: '2026-06-04T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: `pipeline task ${id}`,
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  bundle.failure.taxonomy = ['tool_choice_failure.bad_args']
  bundle.evaluation.final_outcome = finalOutcome
  bundle.evaluation.resolved_label = finalOutcome === 'resolved'
  bundle.evaluation.exit_codes = finalOutcome === 'resolved' ? [0] : [1]
  return bundle
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

describe('Leviathan learning pipeline files', () => {
  test('runs candidate training evaluation and promotion reports into one artifact directory', () => {
    withTempDir(dir => {
      const trainingRolloutPath = writeJson(
        dir,
        'train-rollout.json',
        rollout('train', 'shadow', 'unresolved'),
      )
      const heldOutRolloutPath = writeJson(
        dir,
        'held-out-rollout.json',
        rollout('held_out', 'held_out', 'resolved'),
      )
      const polarTrainingPath = writeJson(dir, 'polar-training.json', [
        polarObservation('case_a_no_tool', {
          captured_requests_count: 0,
        }),
        polarObservation('case_b_file_read_write'),
        polarObservation('case_c_test_execution'),
      ])
      const polarEvalPath = writeJson(dir, 'polar-eval.json', [
        polarObservation('case_a_no_tool'),
        polarObservation('case_b_file_read_write'),
        polarObservation('case_c_test_execution'),
      ])
      const replayPath = writeJson(dir, 'replay.json', [{ passed: true }])
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
      const outputDir = join(dir, 'artifacts')

      const result = runLearningPipelineFromFiles({
        output_dir: outputDir,
        training_run_id: 'train_1',
        provider_model_id: 'mimo-v2.5',
        base_heuristic_bundle_version: 'hb:initial',
        base_harness_version: 'git:abc123',
        rollout_bundle_paths: [trainingRolloutPath],
        held_out_rollout_paths: [heldOutRolloutPath],
        polar_training_observations_path: polarTrainingPath,
        polar_eval_observations_path: polarEvalPath,
        replay_results_path: replayPath,
        security_scan_path: securityPath,
        complexity_budget_path: complexityPath,
        target_failure_slice_path: targetSlicePath,
        regressions_path: regressionsPath,
      })

      expect(result.manifest.status).toBe('ready_for_stable_promotion')
      expect(result.manifest.provider_model_update).toBe('none')
      expect(result.manifest.stable_promotion_ready).toBe(true)
      expect(result.manifest.artifacts.heuristic_training).toBe(
        join(outputDir, 'heuristic-candidates.json'),
      )
      expect(result.manifest.artifacts.polar_training).toBe(
        join(outputDir, 'polar-candidates.json'),
      )
      expect(result.manifest.artifacts.learning_bundle).toBe(
        join(outputDir, 'learning-bundle.json'),
      )
      expect(result.manifest.reports.heuristic_promotion_status).toBe(
        'ready_for_stable_promotion',
      )
      expect(result.manifest.reports.polar_promotion_status).toBe(
        'ready_for_stable_promotion',
      )
      expect(result.manifest.reports.learning_bundle_status).toBe(
        'ready_for_activation',
      )
      const bundle = JSON.parse(
        readFileSync(result.manifest.artifacts.learning_bundle, 'utf8'),
      )
      expect(bundle.status).toBe('ready_for_activation')
      expect(bundle.provider_model_update).toBe('none')
      expect(bundle.stable_activation_allowed).toBe(true)
      expect(
        JSON.parse(readFileSync(result.manifest.artifacts.manifest, 'utf8')),
      ).toEqual(result.manifest)
    })
  })

  test('keeps the pipeline in needs-more-evidence when hard gates reject promotion', () => {
    withTempDir(dir => {
      const trainingRolloutPath = writeJson(
        dir,
        'train-rollout.json',
        rollout('train', 'shadow', 'unresolved'),
      )
      const heldOutRolloutPath = writeJson(
        dir,
        'held-out-rollout.json',
        rollout('held_out', 'held_out', 'unresolved'),
      )
      const polarTrainingPath = writeJson(dir, 'polar-training.json', [
        polarObservation('case_a_no_tool', {
          captured_requests_count: 0,
        }),
      ])
      const polarEvalPath = writeJson(dir, 'polar-eval.json', [
        polarObservation('case_a_no_tool', {
          captured_requests_count: 0,
        }),
      ])
      const replayPath = writeJson(dir, 'replay.json', [{ passed: false }])
      const securityPath = writeJson(dir, 'security.json', { passed: false })
      const complexityPath = writeJson(dir, 'complexity.json', {
        passed: false,
        token_turn_cost_regression_pct: 0.25,
      })
      const targetSlicePath = writeJson(dir, 'target-slice.json', {
        before_success_rate: 0.5,
        after_success_rate: 0.51,
        min_delta: 0.05,
      })
      const regressionsPath = writeJson(dir, 'regressions.json', {
        p0_p1_count: 1,
      })

      const result = runLearningPipelineFromFiles({
        output_dir: join(dir, 'artifacts'),
        training_run_id: 'train_rejected',
        provider_model_id: 'mimo-v2.5',
        base_heuristic_bundle_version: 'hb:initial',
        base_harness_version: 'git:abc123',
        rollout_bundle_paths: [trainingRolloutPath],
        held_out_rollout_paths: [heldOutRolloutPath],
        polar_training_observations_path: polarTrainingPath,
        polar_eval_observations_path: polarEvalPath,
        replay_results_path: replayPath,
        security_scan_path: securityPath,
        complexity_budget_path: complexityPath,
        target_failure_slice_path: targetSlicePath,
        regressions_path: regressionsPath,
      })

      expect(result.manifest.status).toBe('needs_more_evidence')
      expect(result.manifest.stable_promotion_ready).toBe(false)
      expect(result.manifest.reports.heuristic_promotion_status).toBe('rejected')
      expect(result.manifest.reports.polar_promotion_status).toBe('rejected')
      expect(result.manifest.reports.learning_bundle_status).toBe('blocked')
      const bundle = JSON.parse(
        readFileSync(result.manifest.artifacts.learning_bundle, 'utf8'),
      )
      expect(bundle.status).toBe('blocked')
      expect(bundle.stable_activation_allowed).toBe(false)
      expect(bundle.blocked_reasons).toContain('heuristic_report.status.rejected')
    })
  })
})
