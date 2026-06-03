import type {
  TrainingLaunchDecision,
  TrainingLaunchPlan,
} from './trainingLaunch.js'
import type { TrainingReadinessCheckId } from './trainingReadiness.js'

export const TRAINING_RUN_MANIFEST_SCHEMA_VERSION =
  'leviathan.training_run.v1' as const

export type TrainingRunManifestInput = {
  run_id: string
  created_at: string
  cwd_alias: string
  git_commit: string
  rollback_checkpoint_tag: string
  launch_decision: TrainingLaunchDecision
}

export type BlockedTrainingRun = {
  failed_checks: TrainingReadinessCheckId[]
  reasons: string[]
}

export type TrainingRunManifest = {
  schema_version: typeof TRAINING_RUN_MANIFEST_SCHEMA_VERSION
  run_id: string
  created_at: string
  status: 'started' | 'blocked'
  cwd_alias: string
  git_commit: string
  rollback_checkpoint_tag: string
  launch: TrainingLaunchPlan | null
  blocked: BlockedTrainingRun | null
}

export function createTrainingRunManifest(
  input: TrainingRunManifestInput,
): TrainingRunManifest {
  const base = {
    schema_version: TRAINING_RUN_MANIFEST_SCHEMA_VERSION,
    run_id: input.run_id,
    created_at: input.created_at,
    cwd_alias: input.cwd_alias,
    git_commit: input.git_commit,
    rollback_checkpoint_tag: input.rollback_checkpoint_tag,
  }

  if (input.launch_decision.status === 'blocked') {
    return {
      ...base,
      status: 'blocked',
      launch: null,
      blocked: {
        failed_checks: input.launch_decision.failed_checks,
        reasons: input.launch_decision.reasons,
      },
    }
  }

  return {
    ...base,
    status: 'started',
    launch: input.launch_decision.plan,
    blocked: null,
  }
}
