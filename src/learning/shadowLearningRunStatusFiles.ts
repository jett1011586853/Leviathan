import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import type {
  ShadowLearningRun,
  ShadowLearningRunSplitPlan,
} from './shadowLearningRunFiles.js'
import type { LeviathanRolloutBundle } from './rolloutSchema.js'
import type { TrainingRunManifest } from './trainingRunManifest.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export const SHADOW_LEARNING_STATUS_SCHEMA_VERSION =
  'leviathan.shadow_learning_status.v1' as const

export type ShadowLearningEvidenceFile = {
  file: string
  gate: string
}

export const REQUIRED_SHADOW_LEARNING_EVIDENCE_FILES: ShadowLearningEvidenceFile[] =
  [
    {
      file: 'replay-results.json',
      gate: 'replay_runner_fixed_task_reproducible',
    },
    {
      file: 'failure-taxonomy.json',
      gate: 'failure_taxonomy_covers_high_frequency_failures',
    },
    {
      file: 'benchmark-splits.json',
      gate: 'benchmark_splits_isolated',
    },
    {
      file: 'polar-spike-observations.json',
      gate: 'polar_proxy_spike_cases_passed',
    },
    {
      file: 'reward-design.json',
      gate: 'sparse_outcome_reward_defined',
    },
    {
      file: 'rollback-incident-plan.json',
      gate: 'rollback_and_incident_plan_ready',
    },
  ]

const REQUIRED_PIPELINE_ARTIFACTS = [
  'heuristic-candidates.json',
  'polar-candidates.json',
  'promotion-snapshot.json',
  'heuristic-evidence.json',
  'polar-evidence.json',
  'heuristic-promotion-report.json',
  'polar-promotion-report.json',
  'learning-bundle.json',
  'learning-pipeline-manifest.json',
] as const

export type ShadowLearningRunStatusFileInput = {
  run_dir: string
}

export type WriteShadowLearningRunStatusFileInput =
  ShadowLearningRunStatusFileInput & {
    output_path: string
  }

export type ShadowLearningRunStatusFileResult = {
  output_path: string
  status: ShadowLearningRunStatusSnapshot
}

export type ShadowLearningRunStatusSnapshot = {
  schema_version: typeof SHADOW_LEARNING_STATUS_SCHEMA_VERSION
  run_id: string
  status: ShadowLearningRun['status']
  provider_model_id: string
  provider_model_update: 'none'
  target_rollout_count: number
  minimum_trainable_rollouts: number
  split_plan: ShadowLearningRunSplitPlan
  rollout_counts: {
    raw: number
    annotated: {
      train: number
      dev: number
      held_out: number
      total: number
    }
  }
  evidence: {
    present_files: string[]
    missing_files: string[]
    missing_gates: string[]
  }
  annotation_quality: {
    missing_root_cause_summary: {
      train: number
      dev: number
      total: number
    }
    missing_root_cause_files: {
      train: string[]
      dev: string[]
    }
  }
  pipeline: {
    present_artifacts: string[]
    missing_artifacts: string[]
    learning_bundle_present: boolean
    active_state_present: boolean
  }
  readiness: {
    raw_rollouts_collected: boolean
    minimum_trainable_rollouts_ready: boolean
    train_split_ready: boolean
    dev_split_ready: boolean
    held_out_split_ready: boolean
    evidence_files_present: boolean
    annotation_quality_ready: boolean
    formal_gates_cleared: boolean
  }
  ready_for_pipeline: boolean
  next_actions: string[]
}

function readJsonFile<T>(path: string): T {
  return jsonParse(readFileSync(path, 'utf8')) as T
}

function resolveRunPath(
  runDir: string,
  path: string | undefined,
  fallback: string,
): string {
  if (!path) return join(runDir, fallback)
  if (isAbsolute(path) || existsSync(path)) return path
  return join(runDir, fallback)
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort()
}

function presentFiles(dir: string, files: readonly string[]): string[] {
  return files.filter(file => existsSync(join(dir, file)))
}

function missingFiles(dir: string, files: readonly string[]): string[] {
  return files.filter(file => !existsSync(join(dir, file)))
}

function missingSplitAction(
  split: 'train' | 'dev' | 'held_out',
  missing: number,
): string | null {
  return missing > 0
    ? `Annotate ${missing} more file(s) into rollouts/annotated/${split}.`
    : null
}

function nextActions(input: {
  rawMissing: number
  trainMissing: number
  devMissing: number
  heldOutMissing: number
  missingEvidenceFiles: string[]
  missingGates: string[]
  missingRootCauseSummaries: number
  readyForPipeline: boolean
}): string[] {
  const actions = [
    input.rawMissing > 0
      ? `Collect ${input.rawMissing} more raw rollout file(s).`
      : null,
    missingSplitAction('train', input.trainMissing),
    missingSplitAction('dev', input.devMissing),
    missingSplitAction('held_out', input.heldOutMissing),
    input.missingEvidenceFiles.length > 0
      ? `Add required evidence file(s): ${input.missingEvidenceFiles.join(', ')}.`
      : null,
    input.missingGates.length > 0
      ? `Resolve formal launch gate(s): ${input.missingGates.join(', ')}.`
      : null,
    input.missingRootCauseSummaries > 0
      ? `Add root-cause summaries to ${input.missingRootCauseSummaries} train/dev annotated rollout file(s).`
      : null,
    input.readyForPipeline
      ? 'Run /learning run-pipeline with train rollouts, held-out rollouts, and evidence files.'
      : 'Do not run /learning run-pipeline until ready_for_pipeline=true.',
  ]

  return actions.filter((action): action is string => action !== null)
}

function hasTrainableTaxonomy(bundle: LeviathanRolloutBundle): boolean {
  return bundle.failure.taxonomy.length > 0
}

function relativeStatusPath(relativeDir: string, file: string): string {
  return `${relativeDir}/${file}`.replace(/\\/g, '/')
}

function missingRootCauseSummaryFiles(
  dir: string,
  relativeDir: string,
): string[] {
  return jsonFiles(dir).flatMap(file => {
    const bundle = readJsonFile<LeviathanRolloutBundle>(join(dir, file))
    const missing =
      hasTrainableTaxonomy(bundle) &&
      bundle.failure.root_cause_summary.trim().length === 0
    return missing ? [relativeStatusPath(relativeDir, file)] : []
  })
}

export function readShadowLearningRunStatusFromFiles(
  input: ShadowLearningRunStatusFileInput,
): ShadowLearningRunStatusSnapshot {
  const shadowManifestPath = join(input.run_dir, 'shadow-learning-run.json')
  const run = readJsonFile<ShadowLearningRun>(shadowManifestPath)
  const artifacts = run.artifacts
  const formalManifestPath = resolveRunPath(
    input.run_dir,
    artifacts.formal_manifest,
    'formal-launch-manifest.json',
  )
  const formalManifest = existsSync(formalManifestPath)
    ? readJsonFile<TrainingRunManifest>(formalManifestPath)
    : null

  const rawDir = resolveRunPath(
    input.run_dir,
    artifacts.raw_rollouts_dir,
    join('rollouts', 'raw'),
  )
  const trainDir = resolveRunPath(
    input.run_dir,
    artifacts.annotated_train_dir,
    join('rollouts', 'annotated', 'train'),
  )
  const devDir = resolveRunPath(
    input.run_dir,
    artifacts.annotated_dev_dir,
    join('rollouts', 'annotated', 'dev'),
  )
  const heldOutDir = resolveRunPath(
    input.run_dir,
    artifacts.annotated_held_out_dir,
    join('rollouts', 'annotated', 'held_out'),
  )
  const evidenceDir = resolveRunPath(
    input.run_dir,
    artifacts.evidence_dir,
    'evidence',
  )
  const pipelineDir = resolveRunPath(
    input.run_dir,
    artifacts.pipeline_dir,
    'pipeline',
  )
  const activeStatePath = resolveRunPath(
    input.run_dir,
    artifacts.active_state_path,
    'active-learning.json',
  )

  const raw = jsonFiles(rawDir).length
  const train = jsonFiles(trainDir).length
  const dev = jsonFiles(devDir).length
  const held_out = jsonFiles(heldOutDir).length
  const annotatedTotal = train + dev + held_out
  const trainMissingRootCauseFiles = missingRootCauseSummaryFiles(
    trainDir,
    'rollouts/annotated/train',
  )
  const devMissingRootCauseFiles = missingRootCauseSummaryFiles(
    devDir,
    'rollouts/annotated/dev',
  )
  const trainMissingRootCause = trainMissingRootCauseFiles.length
  const devMissingRootCause = devMissingRootCauseFiles.length
  const missingRootCauseTotal = trainMissingRootCause + devMissingRootCause
  const requiredEvidenceFiles = REQUIRED_SHADOW_LEARNING_EVIDENCE_FILES.map(
    evidence => evidence.file,
  )
  const missingEvidenceFiles = missingFiles(evidenceDir, requiredEvidenceFiles)
  const missingGates = formalManifest?.blocked?.failed_checks ?? []
  const pipelinePresentArtifacts = presentFiles(
    pipelineDir,
    REQUIRED_PIPELINE_ARTIFACTS,
  )
  const pipelineMissingArtifacts = missingFiles(
    pipelineDir,
    REQUIRED_PIPELINE_ARTIFACTS,
  )
  const trainMissing = Math.max(0, run.split_plan.train - train)
  const devMissing = Math.max(0, run.split_plan.dev - dev)
  const heldOutMissing = Math.max(0, run.split_plan.held_out - held_out)
  const rawMissing = Math.max(0, run.target_rollout_count - raw)
  const readiness = {
    raw_rollouts_collected: raw >= run.target_rollout_count,
    minimum_trainable_rollouts_ready:
      annotatedTotal >= run.minimum_trainable_rollouts,
    train_split_ready: train >= run.split_plan.train,
    dev_split_ready: dev >= run.split_plan.dev,
    held_out_split_ready: held_out >= run.split_plan.held_out,
    evidence_files_present: missingEvidenceFiles.length === 0,
    annotation_quality_ready: missingRootCauseTotal === 0,
    formal_gates_cleared: formalManifest?.status === 'started',
  }
  const readyForPipeline =
    run.provider_model_update === 'none' &&
    readiness.raw_rollouts_collected &&
    readiness.minimum_trainable_rollouts_ready &&
    readiness.train_split_ready &&
    readiness.dev_split_ready &&
    readiness.held_out_split_ready &&
    readiness.evidence_files_present &&
    readiness.annotation_quality_ready &&
    readiness.formal_gates_cleared

  return {
    schema_version: SHADOW_LEARNING_STATUS_SCHEMA_VERSION,
    run_id: run.run_id,
    status: run.status,
    provider_model_id: run.provider_model_id,
    provider_model_update: run.provider_model_update,
    target_rollout_count: run.target_rollout_count,
    minimum_trainable_rollouts: run.minimum_trainable_rollouts,
    split_plan: run.split_plan,
    rollout_counts: {
      raw,
      annotated: {
        train,
        dev,
        held_out,
        total: annotatedTotal,
      },
    },
    evidence: {
      present_files: jsonFiles(evidenceDir),
      missing_files: missingEvidenceFiles,
      missing_gates: missingGates,
    },
    annotation_quality: {
      missing_root_cause_summary: {
        train: trainMissingRootCause,
        dev: devMissingRootCause,
        total: missingRootCauseTotal,
      },
      missing_root_cause_files: {
        train: trainMissingRootCauseFiles,
        dev: devMissingRootCauseFiles,
      },
    },
    pipeline: {
      present_artifacts: pipelinePresentArtifacts,
      missing_artifacts: pipelineMissingArtifacts,
      learning_bundle_present: existsSync(
        join(pipelineDir, 'learning-bundle.json'),
      ),
      active_state_present: existsSync(activeStatePath),
    },
    readiness,
    ready_for_pipeline: readyForPipeline,
    next_actions: nextActions({
      rawMissing,
      trainMissing,
      devMissing,
      heldOutMissing,
      missingEvidenceFiles,
      missingGates,
      missingRootCauseSummaries: missingRootCauseTotal,
      readyForPipeline,
    }),
  }
}

export function writeShadowLearningRunStatusFile(
  input: WriteShadowLearningRunStatusFileInput,
): ShadowLearningRunStatusFileResult {
  const status = readShadowLearningRunStatusFromFiles({
    run_dir: input.run_dir,
  })
  mkdirSync(dirname(input.output_path), { recursive: true })
  writeFileSync_DEPRECATED(
    input.output_path,
    jsonStringify(status, null, 2),
    {
      encoding: 'utf-8',
      flush: true,
    },
  )

  return {
    output_path: input.output_path,
    status,
  }
}
