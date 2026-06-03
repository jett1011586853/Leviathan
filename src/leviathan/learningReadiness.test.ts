import { describe, expect, test } from 'bun:test'

import {
  TRAINING_READINESS_CHECKS,
  evaluateTrainingReadiness,
} from '../learning/trainingReadiness.js'
import { buildTrainingReadinessEvidence } from '../learning/trainingReadinessEvidence.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'
import type { BenchmarkTaskRecord } from '../learning/benchmarkGovernance.js'
import type { PolarProxySpikeObservation } from '../learning/polarProxySpike.js'
import type { RewardDesign } from '../learning/rewardDesign.js'
import type {
  BaselineExperimentArmId,
  PolicyTrainability,
} from '../learning/baselineMatrix.js'

function readinessRollout(id: string, taxonomy: string[]) {
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
    userInstruction: 'readiness sample',
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
    benchmark_instance_id: '',
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

describe('Leviathan training readiness checklist', () => {
  test('keeps formal training blocked until every v1.0 hard gate has evidence', () => {
    const result = evaluateTrainingReadiness({
      concept_boundaries_fixed: true,
      trainable_policy_boundaries_fixed: true,
      rollout_schema_v1_implemented: true,
      required_fields_landable: true,
      optional_field_degradation_defined: true,
      data_redaction_exporter_implemented: true,
      replay_runner_fixed_task_reproducible: false,
      failure_taxonomy_covers_high_frequency_failures: false,
      heuristic_promotion_gate_implemented: true,
      updater_candidate_only_enforced: true,
      benchmark_splits_isolated: false,
      polar_proxy_spike_cases_passed: false,
      provider_scope_locked_direct_anthropic: true,
      sparse_outcome_reward_defined: false,
      baseline_matrix_fixed: true,
      result_reporting_split_by_source: true,
      rollback_and_incident_plan_ready: false,
    })

    expect(result.ready_for_formal_training).toBe(false)
    expect(result.passed).toContain('rollout_schema_v1_implemented')
    expect(result.failed).toEqual([
      'replay_runner_fixed_task_reproducible',
      'failure_taxonomy_covers_high_frequency_failures',
      'benchmark_splits_isolated',
      'polar_proxy_spike_cases_passed',
      'sparse_outcome_reward_defined',
      'rollback_and_incident_plan_ready',
    ])
  })

  test('approves formal training only when the full checklist passes', () => {
    const allTrueEvidence = Object.fromEntries(
      TRAINING_READINESS_CHECKS.map(check => [check.id, true]),
    ) as Record<(typeof TRAINING_READINESS_CHECKS)[number]['id'], boolean>

    const result = evaluateTrainingReadiness(allTrueEvidence)

    expect(result.ready_for_formal_training).toBe(true)
    expect(result.failed).toEqual([])
    expect(result.passed).toHaveLength(TRAINING_READINESS_CHECKS.length)
  })

  test('exposes user-facing readiness labels for each hard gate', () => {
    expect(TRAINING_READINESS_CHECKS.map(check => check.label)).toEqual([
      'HL / Polar / Leviathan harness boundaries fixed',
      'Trainable policy boundary fixed',
      'Rollout schema v1 implemented',
      'Required rollout fields can be persisted',
      'Optional field degradation strategy defined',
      'Data redaction exporter implemented',
      'Replay runner reproduces fixed task set',
      'Failure taxonomy covers high-frequency failures',
      'Heuristic promotion gate implemented',
      'HL updater is candidate-only',
      'Benchmark train/dev/test/secret splits isolated',
      'Polar proxy spike cases passed',
      'Provider scope locked to Anthropic-compatible direct mode',
      'Sparse outcome reward defined',
      'Baseline experiment matrix fixed',
      'Result reporting split by internal/public/private',
      'Rollback and incident plan ready',
    ])
  })

  test('builds readiness evidence from implemented local infrastructure without approving missing external gates', () => {
    const rollouts = [
      readinessRollout('1', ['model_interaction_failure.provider_mismatch']),
      readinessRollout('2', ['tool_choice_failure.bad_args']),
      readinessRollout('3', ['verification_failure.flaky_tests']),
      readinessRollout('4', ['security_governance_failure.secret_leak']),
      readinessRollout('5', []),
    ]

    const evidence = buildTrainingReadinessEvidence({
      rollout_bundles: rollouts,
      replay_results: [
        {
          status: 'completed',
          blockers: [],
          compare_passed: true,
        },
      ],
      provider_scope: 'anthropic-compatible-direct',
      benchmark_splits_isolated: false,
      polar_proxy_spike_cases_passed: false,
      sparse_outcome_reward_defined: false,
      rollback_and_incident_plan_ready: false,
    })
    const result = evaluateTrainingReadiness(evidence)

    expect(evidence.rollout_schema_v1_implemented).toBe(true)
    expect(evidence.required_fields_landable).toBe(true)
    expect(evidence.replay_runner_fixed_task_reproducible).toBe(true)
    expect(evidence.failure_taxonomy_covers_high_frequency_failures).toBe(true)
    expect(evidence.heuristic_promotion_gate_implemented).toBe(true)
    expect(evidence.polar_proxy_spike_cases_passed).toBe(false)
    expect(evidence.benchmark_splits_isolated).toBe(false)
    expect(result.ready_for_formal_training).toBe(false)
    expect(result.failed).toContain('polar_proxy_spike_cases_passed')
    expect(result.failed).toContain('benchmark_splits_isolated')
  })

  test('derives benchmark readiness from split governance records', () => {
    const evidence = buildTrainingReadinessEvidence({
      rollout_bundles: [
        readinessRollout('1', ['tool_choice_failure.bad_args']),
        readinessRollout('2', ['verification_failure.flaky_tests']),
        readinessRollout('3', ['security_governance_failure.secret_leak']),
        readinessRollout('4', ['model_interaction_failure.provider_mismatch']),
      ],
      replay_results: [
        {
          status: 'completed',
          blockers: [],
          compare_passed: true,
        },
      ],
      provider_scope: 'anthropic-compatible-direct',
      benchmark_records: [
        benchmarkRecord('train_1'),
        benchmarkRecord('dev_1', {
          split: 'dev',
          allow_policy_training: false,
        }),
        benchmarkRecord('public_1', {
          split: 'test',
          source: 'swe-bench-live',
          public_visibility: 'public',
          allow_policy_training: false,
          allow_global_memory: false,
        }),
        benchmarkRecord('secret_1', {
          split: 'secret',
          source: 'secret',
          public_visibility: 'private',
          allow_policy_training: false,
          allow_global_memory: false,
        }),
      ],
      polar_proxy_spike_cases_passed: false,
      sparse_outcome_reward_defined: false,
      rollback_and_incident_plan_ready: false,
    })

    expect(evidence.benchmark_splits_isolated).toBe(true)
    expect(evidence.result_reporting_split_by_source).toBe(true)
  })

  test('keeps benchmark readiness false when split governance detects leakage', () => {
    const evidence = buildTrainingReadinessEvidence({
      rollout_bundles: [readinessRollout('1', ['tool_choice_failure.bad_args'])],
      replay_results: [
        {
          status: 'completed',
          blockers: [],
          compare_passed: true,
        },
      ],
      provider_scope: 'anthropic-compatible-direct',
      benchmark_records: [
        benchmarkRecord('leaky_eval', {
          split: 'test',
          source: 'swe-bench-verified',
          public_visibility: 'public',
          allow_policy_training: true,
          allow_global_memory: true,
        }),
      ],
      polar_proxy_spike_cases_passed: false,
      sparse_outcome_reward_defined: false,
      rollback_and_incident_plan_ready: false,
    })

    expect(evidence.benchmark_splits_isolated).toBe(false)
    expect(evidence.result_reporting_split_by_source).toBe(true)
  })

  test('derives Polar readiness from all three spike case observations', () => {
    const evidence = buildTrainingReadinessEvidence({
      rollout_bundles: [readinessRollout('1', ['tool_choice_failure.bad_args'])],
      replay_results: [
        {
          status: 'completed',
          blockers: [],
          compare_passed: true,
        },
      ],
      provider_scope: 'anthropic-compatible-direct',
      benchmark_records: [
        benchmarkRecord('train_1'),
        benchmarkRecord('secret_1', {
          split: 'secret',
          source: 'secret',
          allow_policy_training: false,
          allow_global_memory: false,
        }),
      ],
      polar_spike_observations: [
        polarObservation('case_a_no_tool'),
        polarObservation('case_b_file_read_write'),
        polarObservation('case_c_test_execution'),
      ],
      sparse_outcome_reward_defined: false,
      rollback_and_incident_plan_ready: false,
    })

    expect(evidence.polar_proxy_spike_cases_passed).toBe(true)
  })

  test('keeps Polar readiness false when a spike case fails', () => {
    const evidence = buildTrainingReadinessEvidence({
      rollout_bundles: [readinessRollout('1', ['tool_choice_failure.bad_args'])],
      replay_results: [
        {
          status: 'completed',
          blockers: [],
          compare_passed: true,
        },
      ],
      provider_scope: 'anthropic-compatible-direct',
      benchmark_records: [],
      polar_spike_observations: [
        polarObservation('case_a_no_tool', {
          captured_requests_count: 0,
        }),
        polarObservation('case_b_file_read_write'),
        polarObservation('case_c_test_execution'),
      ],
      sparse_outcome_reward_defined: false,
      rollback_and_incident_plan_ready: false,
    })

    expect(evidence.polar_proxy_spike_cases_passed).toBe(false)
  })

  test('derives reward and baseline readiness from explicit designs', () => {
    const evidence = buildTrainingReadinessEvidence({
      rollout_bundles: [readinessRollout('1', ['tool_choice_failure.bad_args'])],
      replay_results: [
        {
          status: 'completed',
          blockers: [],
          compare_passed: true,
        },
      ],
      provider_scope: 'anthropic-compatible-direct',
      benchmark_records: [],
      polar_spike_observations: [
        polarObservation('case_a_no_tool'),
        polarObservation('case_b_file_read_write'),
        polarObservation('case_c_test_execution'),
      ],
      reward_design: {
        mode: 'sparse_outcome',
        reward_range: [0, 1],
        uses_trace_shaping: false,
        broadcasts_session_reward_to_requests: false,
      } satisfies RewardDesign,
      baseline_matrix: {
        policy_trainability: 'closed_api' satisfies PolicyTrainability,
        enabled_arms: [
          'baseline',
          'hl_only',
        ] satisfies BaselineExperimentArmId[],
      },
      rollback_and_incident_plan_ready: false,
    })

    expect(evidence.sparse_outcome_reward_defined).toBe(true)
    expect(evidence.baseline_matrix_fixed).toBe(true)
  })

  test('rejects dense reward and invalid baseline matrix in readiness evidence', () => {
    const evidence = buildTrainingReadinessEvidence({
      rollout_bundles: [readinessRollout('1', ['tool_choice_failure.bad_args'])],
      replay_results: [],
      provider_scope: 'anthropic-compatible-direct',
      benchmark_records: [],
      polar_spike_observations: [],
      reward_design: {
        mode: 'dense_shaping',
        reward_range: [-1, 1],
        uses_trace_shaping: true,
        broadcasts_session_reward_to_requests: true,
      } satisfies RewardDesign,
      baseline_matrix: {
        policy_trainability: 'closed_api' satisfies PolicyTrainability,
        enabled_arms: [
          'baseline',
          'hl_only',
          'polar_only',
        ] satisfies BaselineExperimentArmId[],
      },
      rollback_and_incident_plan_ready: false,
    })

    expect(evidence.sparse_outcome_reward_defined).toBe(false)
    expect(evidence.baseline_matrix_fixed).toBe(false)
  })
})
