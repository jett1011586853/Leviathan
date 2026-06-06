import type {
  CandidateHeuristicType,
  HeuristicCandidate,
} from './promotionGate.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'

export const HEURISTIC_TRAINING_SCHEMA_VERSION =
  'leviathan.heuristic_training.v1' as const

export type HeuristicTrainingInput = {
  training_run_id: string
  provider_model_id: string
  base_heuristic_bundle_version: string
  rollouts: LeviathanRolloutBundle[]
}

export type HeuristicTrainingResult = {
  schema_version: typeof HEURISTIC_TRAINING_SCHEMA_VERSION
  status: 'candidate_only' | 'blocked'
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  base_heuristic_bundle_version: string
  candidate_heuristic_bundle_version: string
  stable_promotions_allowed: false
  trained_failure_classes: string[]
  candidates: HeuristicCandidate[]
  blocked_reasons: string[]
}

const FAILURE_TO_CANDIDATE_TYPE: Record<string, CandidateHeuristicType> = {
  model_interaction_failure: 'candidate prompt policy',
  tool_choice_failure: 'candidate tool policy',
  execution_environment_failure: 'candidate recovery rule',
  code_modification_failure: 'candidate controller patch',
  verification_failure: 'candidate regression test',
  memory_context_failure: 'candidate memory',
  recovery_control_failure: 'candidate recovery rule',
  security_governance_failure: 'candidate controller patch',
}

const FAILURE_TO_LEARNED_GUIDANCE: Record<string, string[]> = {
  model_interaction_failure: [
    'Honor the user configured provider base URL, auth token, and model id on every model request; do not substitute recovered product defaults or hidden fallback models.',
    'When auditing provider behavior, verify the actual request path and model resolver before concluding the provider adapter is correct.',
  ],
  tool_choice_failure: [
    'Before emitting a tool call, verify the tool name is present in the current available tool set; if Glob, Read, or another familiar tool is unavailable, use an available equivalent instead of calling it.',
    'Validate required tool input fields and path arguments before the call; prefer confirmed cwd or repo-relative paths over unverified $WORKDIR placeholders.',
  ],
  execution_environment_failure: [
    'Treat failed shell commands as syntax, cwd, permission, dependency, or timeout signals only after inspecting stderr, exit code, and the exact command that ran.',
    'Use balanced quoting for path variables and avoid literal placeholder paths unless the variable is actually exported in the shell environment.',
  ],
  code_modification_failure: [
    'Before editing, inspect current file content and git status so stale reads, dirty worktree changes, and user edits are preserved.',
    'Prefer narrow patches tied to current context; if replacement context is ambiguous, reread the file and rebuild the patch instead of forcing a broad edit.',
  ],
  verification_failure: [
    'Run the smallest relevant verification command after a change and capture exit code plus failure output before claiming resolution.',
    'Separate pre-existing or flaky failures from regressions introduced by the current trajectory.',
  ],
  memory_context_failure: [
    'Treat compacted summaries, resumed state, and recalled memory as hypotheses until checked against the newest user request and current workspace state.',
    'When context conflicts, prefer fresh file reads and the latest conversation turn over stale memory artifacts.',
  ],
  recovery_control_failure: [
    'After a tool or command failure, inspect the concrete stderr, exit code, cwd, and previous tool input before retrying.',
    'Retry with a corrected plan once; avoid repeating the same failed command or tool input without new evidence.',
  ],
  security_governance_failure: [
    'Do not print, request, or persist secrets during audits, rollouts, or learning artifacts; redact provider credentials and local absolute paths.',
    'Keep held-out evidence isolated from training and block promotion when benchmark leakage or unsafe export evidence appears.',
  ],
}

function primaryFailureClass(taxonomy: string): string {
  return taxonomy.split('.')[0] ?? ''
}

function candidateForFailureClass(
  failureClass: string,
  sourceTaxonomy: string[],
): HeuristicCandidate {
  const featureFlag = `hl.candidate.${failureClass}_001`
  return {
    id: `candidate_${failureClass}_001`,
    type: FAILURE_TO_CANDIDATE_TYPE[failureClass]!,
    status: 'candidate',
    source_failure_taxonomy: sourceTaxonomy,
    learned_guidance: [...(FAILURE_TO_LEARNED_GUIDANCE[failureClass] ?? [])],
    feature_flag: featureFlag,
    rollback_plan: `Disable feature flag ${featureFlag}`,
  }
}

function groupTrainableTaxonomy(
  rollouts: LeviathanRolloutBundle[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>()

  for (const rollout of rollouts) {
    for (const taxonomy of rollout.failure.taxonomy) {
      const failureClass = primaryFailureClass(taxonomy)
      if (!FAILURE_TO_CANDIDATE_TYPE[failureClass]) continue
      const values = grouped.get(failureClass) ?? []
      if (!values.includes(taxonomy)) values.push(taxonomy)
      grouped.set(failureClass, values)
    }
  }

  return grouped
}

function hasFinalEvaluationRollout(rollouts: LeviathanRolloutBundle[]): boolean {
  return rollouts.some(
    rollout => rollout.run.split === 'test' || rollout.run.split === 'held_out',
  )
}

function hasTrainableTaxonomy(rollout: LeviathanRolloutBundle): boolean {
  return rollout.failure.taxonomy.some(taxonomy => {
    const failureClass = primaryFailureClass(taxonomy)
    return Boolean(FAILURE_TO_CANDIDATE_TYPE[failureClass])
  })
}

function hasMissingRootCauseSummary(
  rollouts: LeviathanRolloutBundle[],
): boolean {
  return rollouts.some(
    rollout =>
      hasTrainableTaxonomy(rollout) &&
      rollout.failure.root_cause_summary.trim().length === 0,
  )
}

export function trainHeuristicCandidatesFromRollouts(
  input: HeuristicTrainingInput,
): HeuristicTrainingResult {
  if (hasFinalEvaluationRollout(input.rollouts)) {
    return {
      schema_version: HEURISTIC_TRAINING_SCHEMA_VERSION,
      status: 'blocked',
      training_run_id: input.training_run_id,
      provider_model_id: input.provider_model_id,
      provider_model_update: 'none',
      base_heuristic_bundle_version: input.base_heuristic_bundle_version,
      candidate_heuristic_bundle_version: `hb:candidate/${input.training_run_id}`,
      stable_promotions_allowed: false,
      trained_failure_classes: [],
      candidates: [],
      blocked_reasons: ['rollouts.final_evaluation_split_not_trainable'],
    }
  }

  if (hasMissingRootCauseSummary(input.rollouts)) {
    return {
      schema_version: HEURISTIC_TRAINING_SCHEMA_VERSION,
      status: 'blocked',
      training_run_id: input.training_run_id,
      provider_model_id: input.provider_model_id,
      provider_model_update: 'none',
      base_heuristic_bundle_version: input.base_heuristic_bundle_version,
      candidate_heuristic_bundle_version: `hb:candidate/${input.training_run_id}`,
      stable_promotions_allowed: false,
      trained_failure_classes: [],
      candidates: [],
      blocked_reasons: ['rollouts.missing_root_cause_summary'],
    }
  }

  const grouped = groupTrainableTaxonomy(input.rollouts)
  const trained_failure_classes = [...grouped.keys()]
  const candidates = trained_failure_classes.map(failureClass =>
    candidateForFailureClass(failureClass, grouped.get(failureClass) ?? []),
  )
  const blocked_reasons =
    candidates.length === 0 ? ['rollouts.no_trainable_failure_taxonomy'] : []

  return {
    schema_version: HEURISTIC_TRAINING_SCHEMA_VERSION,
    status: candidates.length > 0 ? 'candidate_only' : 'blocked',
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    provider_model_update: 'none',
    base_heuristic_bundle_version: input.base_heuristic_bundle_version,
    candidate_heuristic_bundle_version: `hb:candidate/${input.training_run_id}`,
    stable_promotions_allowed: false,
    trained_failure_classes,
    candidates,
    blocked_reasons,
  }
}
