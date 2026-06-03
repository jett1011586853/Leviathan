export const TRAINING_READINESS_CHECKS = [
  {
    id: 'concept_boundaries_fixed',
    label: 'HL / Polar / Leviathan harness boundaries fixed',
  },
  {
    id: 'trainable_policy_boundaries_fixed',
    label: 'Trainable policy boundary fixed',
  },
  {
    id: 'rollout_schema_v1_implemented',
    label: 'Rollout schema v1 implemented',
  },
  {
    id: 'required_fields_landable',
    label: 'Required rollout fields can be persisted',
  },
  {
    id: 'optional_field_degradation_defined',
    label: 'Optional field degradation strategy defined',
  },
  {
    id: 'data_redaction_exporter_implemented',
    label: 'Data redaction exporter implemented',
  },
  {
    id: 'replay_runner_fixed_task_reproducible',
    label: 'Replay runner reproduces fixed task set',
  },
  {
    id: 'failure_taxonomy_covers_high_frequency_failures',
    label: 'Failure taxonomy covers high-frequency failures',
  },
  {
    id: 'heuristic_promotion_gate_implemented',
    label: 'Heuristic promotion gate implemented',
  },
  {
    id: 'updater_candidate_only_enforced',
    label: 'HL updater is candidate-only',
  },
  {
    id: 'benchmark_splits_isolated',
    label: 'Benchmark train/dev/test/secret splits isolated',
  },
  {
    id: 'polar_proxy_spike_cases_passed',
    label: 'Polar proxy spike cases passed',
  },
  {
    id: 'provider_scope_locked_direct_anthropic',
    label: 'Provider scope locked to Anthropic-compatible direct mode',
  },
  {
    id: 'sparse_outcome_reward_defined',
    label: 'Sparse outcome reward defined',
  },
  {
    id: 'baseline_matrix_fixed',
    label: 'Baseline experiment matrix fixed',
  },
  {
    id: 'result_reporting_split_by_source',
    label: 'Result reporting split by internal/public/private',
  },
  {
    id: 'rollback_and_incident_plan_ready',
    label: 'Rollback and incident plan ready',
  },
] as const

export type TrainingReadinessCheckId =
  (typeof TRAINING_READINESS_CHECKS)[number]['id']

export type TrainingReadinessEvidence = Record<
  TrainingReadinessCheckId,
  boolean
>

export type TrainingReadinessResult = {
  ready_for_formal_training: boolean
  passed: TrainingReadinessCheckId[]
  failed: TrainingReadinessCheckId[]
}

export function evaluateTrainingReadiness(
  evidence: TrainingReadinessEvidence,
): TrainingReadinessResult {
  const passed: TrainingReadinessCheckId[] = []
  const failed: TrainingReadinessCheckId[] = []

  for (const check of TRAINING_READINESS_CHECKS) {
    if (evidence[check.id]) {
      passed.push(check.id)
    } else {
      failed.push(check.id)
    }
  }

  return {
    ready_for_formal_training: failed.length === 0,
    passed,
    failed,
  }
}
