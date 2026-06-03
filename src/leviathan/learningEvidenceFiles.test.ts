import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BaselineExperimentArmId } from '../learning/baselineMatrix.js'
import type { BenchmarkTaskRecord } from '../learning/benchmarkGovernance.js'
import {
  buildTrainingLaunchConfigFromEvidenceFiles,
  type TrainingEvidenceFilesInput,
} from '../learning/trainingEvidenceFiles.js'
import { evaluateTrainingLaunch } from '../learning/trainingLaunch.js'
import type { PolarProxySpikeObservation } from '../learning/polarProxySpike.js'
import type { RewardDesign } from '../learning/rewardDesign.js'
import type { RollbackIncidentPlan } from '../learning/rollbackIncidentPlan.js'
import {
  createEmptyRolloutBundle,
  type LeviathanRolloutBundle,
} from '../learning/rolloutSchema.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-evidence-'))
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

function rollout(id: string, taxonomy: string[]): LeviathanRolloutBundle {
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
    userInstruction: 'collect evidence from files',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  bundle.failure.taxonomy = taxonomy
  return bundle
}

function benchmarkRecord(
  id: string,
  overrides: Partial<BenchmarkTaskRecord> = {},
): BenchmarkTaskRecord {
  return {
    id,
    source: 'internal',
    split: 'train',
    repo: 'leviathan',
    base_commit: `commit_${id}`,
    issue_id: `issue_${id}`,
    benchmark_instance_id: `instance_${id}`,
    problem_statement_hash: `problem_${id}`,
    normalized_diff_hash: `diff_${id}`,
    public_visibility: 'private',
    allow_policy_training: true,
    allow_global_memory: true,
    ...overrides,
  }
}

function polarObservation(
  case_id: PolarProxySpikeObservation['case_id'],
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
  }
}

function rollbackIncidentPlan(): RollbackIncidentPlan {
  return {
    permanent_checkpoint_tag: 'checkpoint/pre-hl-polar-training-v1.0',
    rollback_commands: [
      'git switch main',
      'git reset --hard checkpoint/pre-hl-polar-training-v1.0',
    ],
    feature_flags: [
      'hl.rollout_export.enabled',
      'hl.promotion_gate.enabled',
      'polar.proxy_spike.enabled',
    ],
    incident_owner: 'Leviathan maintainer',
    incident_channels: ['local-runbook', 'github-issue'],
    severity_routes: {
      p0: 'Stop training, disable all HL/Polar flags, rotate exposed secrets, restore checkpoint.',
      p1: 'Pause candidate promotion, run replay suite, rollback affected feature flag.',
      p2: 'File issue, keep shadow mode, review next maintenance window.',
    },
    covers: {
      secret_leak: true,
      benchmark_leak: true,
      reward_hacking: true,
      data_corruption: true,
      regression_spike: true,
    },
  }
}

function baseInput(dir: string): TrainingEvidenceFilesInput {
  return {
    provider_model_id: 'mimo-v2.5',
    provider_scope: 'anthropic-compatible-direct',
    git_commit: 'abc123',
    cwd_alias: '$WORKDIR',
    rollback_checkpoint_tag: 'checkpoint/hl-polar-readiness-foundation-v1.0',
    rollout_bundle_paths: [
      writeJson(dir, 'rollout-1.json', rollout('1', ['tool_choice_failure.bad_args'])),
      writeJson(dir, 'rollout-2.json', rollout('2', ['verification_failure.flaky_tests'])),
      writeJson(dir, 'rollout-3.json', rollout('3', ['security_governance_failure.secret_leak'])),
      writeJson(dir, 'rollout-4.json', rollout('4', ['model_interaction_failure.provider_mismatch'])),
      writeJson(dir, 'rollout-5.json', rollout('5', ['recovery_control_failure.no_retry'])),
    ],
  }
}

describe('Leviathan training evidence files', () => {
  test('builds a ready launch config from complete evidence files', () => {
    withTempDir(dir => {
      const baseline = {
        policy_trainability: 'closed_api' as const,
        enabled_arms: [
          'baseline',
          'hl_only',
          'polar_only',
          'hl_polar',
        ] satisfies BaselineExperimentArmId[],
      }
      const config = buildTrainingLaunchConfigFromEvidenceFiles({
        ...baseInput(dir),
        replay_results_path: writeJson(dir, 'replay.json', [
          { status: 'completed', blockers: [], compare_passed: true },
        ]),
        benchmark_records_path: writeJson(dir, 'benchmarks.json', [
          benchmarkRecord('train_1'),
          benchmarkRecord('dev_1', {
            split: 'dev',
            allow_policy_training: false,
          }),
          benchmarkRecord('test_1', {
            split: 'test',
            source: 'swe-bench-live',
            public_visibility: 'public',
            allow_policy_training: false,
            allow_global_memory: false,
          }),
          benchmarkRecord('secret_1', {
            split: 'secret',
            source: 'secret',
            allow_policy_training: false,
            allow_global_memory: false,
          }),
        ]),
        polar_spike_observations_path: writeJson(dir, 'polar.json', [
          polarObservation('case_a_no_tool'),
          polarObservation('case_b_file_read_write'),
          polarObservation('case_c_test_execution'),
        ]),
        reward_design_path: writeJson(dir, 'reward.json', {
          mode: 'sparse_outcome',
          reward_range: [0, 1],
          uses_trace_shaping: false,
          broadcasts_session_reward_to_requests: false,
        } satisfies RewardDesign),
        baseline_matrix_path: writeJson(dir, 'baseline.json', baseline),
        rollback_incident_plan_path: writeJson(
          dir,
          'rollback.json',
          rollbackIncidentPlan(),
        ),
      })

      expect(config.rollout_bundle_count).toBe(5)
      expect(Object.values(config.readiness_evidence).every(Boolean)).toBe(true)
      expect(
        evaluateTrainingLaunch({
          mode: 'formal',
          provider_model_id: config.provider_model_id,
          policy_trainability: config.policy_trainability,
          readiness_evidence: config.readiness_evidence,
          baseline_matrix: config.baseline_matrix,
          rollout_bundle_count: config.rollout_bundle_count,
        }).status,
      ).toBe('ready')
    })
  })

  test('keeps launch config blocked when external evidence files are missing', () => {
    withTempDir(dir => {
      const config = buildTrainingLaunchConfigFromEvidenceFiles(baseInput(dir))
      const decision = evaluateTrainingLaunch({
        mode: 'formal',
        provider_model_id: config.provider_model_id,
        policy_trainability: config.policy_trainability,
        readiness_evidence: config.readiness_evidence,
        baseline_matrix: config.baseline_matrix,
        rollout_bundle_count: config.rollout_bundle_count,
      })

      expect(config.rollout_bundle_count).toBe(5)
      expect(config.readiness_evidence.required_fields_landable).toBe(true)
      expect(config.readiness_evidence.replay_runner_fixed_task_reproducible).toBe(false)
      expect(config.readiness_evidence.polar_proxy_spike_cases_passed).toBe(false)
      expect(config.readiness_evidence.rollback_and_incident_plan_ready).toBe(false)
      expect(decision.status).toBe('blocked')
    })
  })
})
