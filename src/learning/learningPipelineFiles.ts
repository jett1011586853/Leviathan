import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { writeEvaluationSnapshotFromFiles } from './evaluationSnapshotFiles.js'
import {
  trainHeuristicCandidatesFromFiles,
  type TrainHeuristicCandidatesFromFilesResult,
} from './heuristicTrainingFiles.js'
import {
  trainPolarHarnessCandidatesFromFiles,
  type TrainPolarHarnessCandidatesFromFilesResult,
} from './polarHarnessTrainingFiles.js'
import {
  writePolarHarnessPromotionReportFromFiles,
  type WritePolarHarnessPromotionReportFromFilesResult,
} from './polarHarnessPromotionFiles.js'
import {
  writePromotionEvidenceFromSnapshotFiles,
  type WritePromotionEvidenceFromSnapshotFilesResult,
} from './promotionEvidenceFiles.js'
import {
  writeHeuristicPromotionReportFromFiles,
  type WriteHeuristicPromotionReportFromFilesResult,
} from './promotionFiles.js'
import {
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type LearningPipelineStatus =
  | 'ready_for_stable_promotion'
  | 'needs_more_evidence'
  | 'blocked'

export type RunLearningPipelineFromFilesInput = {
  output_dir: string
  training_run_id: string
  provider_model_id: string
  base_heuristic_bundle_version: string
  base_harness_version: string
  rollout_bundle_paths: string[]
  held_out_rollout_paths: string[]
  polar_training_observations_path: string
  polar_eval_observations_path: string
  replay_results_path: string
  security_scan_path: string
  complexity_budget_path: string
  target_failure_slice_path: string
  regressions_path: string
}

export type LearningPipelineArtifacts = {
  heuristic_training: string
  polar_training: string
  evaluation_snapshot: string
  heuristic_promotion_evidence: string
  polar_promotion_evidence: string
  heuristic_promotion_report: string
  polar_promotion_report: string
  manifest: string
}

export type LearningPipelineManifest = {
  schema_version: 'leviathan.learning_pipeline.v1'
  status: LearningPipelineStatus
  training_run_id: string
  provider_model_id: string
  provider_model_update: 'none'
  stable_promotion_ready: boolean
  artifacts: LearningPipelineArtifacts
  reports: {
    heuristic_training_status: TrainHeuristicCandidatesFromFilesResult['training']['status']
    polar_training_status: TrainPolarHarnessCandidatesFromFilesResult['training']['status']
    heuristic_promotion_status: WriteHeuristicPromotionReportFromFilesResult['report']['status']
    polar_promotion_status: WritePolarHarnessPromotionReportFromFilesResult['report']['status']
  }
}

export type RunLearningPipelineFromFilesResult = {
  manifest: LearningPipelineManifest
  heuristic_training: TrainHeuristicCandidatesFromFilesResult
  polar_training: TrainPolarHarnessCandidatesFromFilesResult
  promotion_evidence: WritePromotionEvidenceFromSnapshotFilesResult
  heuristic_promotion: WriteHeuristicPromotionReportFromFilesResult
  polar_promotion: WritePolarHarnessPromotionReportFromFilesResult
}

function artifactPaths(outputDir: string): LearningPipelineArtifacts {
  return {
    heuristic_training: join(outputDir, 'heuristic-candidates.json'),
    polar_training: join(outputDir, 'polar-candidates.json'),
    evaluation_snapshot: join(outputDir, 'promotion-snapshot.json'),
    heuristic_promotion_evidence: join(outputDir, 'heuristic-evidence.json'),
    polar_promotion_evidence: join(outputDir, 'polar-evidence.json'),
    heuristic_promotion_report: join(outputDir, 'heuristic-promotion-report.json'),
    polar_promotion_report: join(outputDir, 'polar-promotion-report.json'),
    manifest: join(outputDir, 'learning-pipeline-manifest.json'),
  }
}

function pipelineStatus(
  heuristicTraining: TrainHeuristicCandidatesFromFilesResult,
  polarTraining: TrainPolarHarnessCandidatesFromFilesResult,
  heuristicPromotion: WriteHeuristicPromotionReportFromFilesResult,
  polarPromotion: WritePolarHarnessPromotionReportFromFilesResult,
): LearningPipelineStatus {
  if (
    heuristicTraining.training.status === 'blocked' ||
    polarTraining.training.status === 'blocked'
  ) {
    return 'blocked'
  }

  return heuristicPromotion.report.status === 'ready_for_stable_promotion' &&
    polarPromotion.report.status === 'ready_for_stable_promotion'
    ? 'ready_for_stable_promotion'
    : 'needs_more_evidence'
}

function writeManifest(manifest: LearningPipelineManifest): void {
  writeFileSync_DEPRECATED(
    manifest.artifacts.manifest,
    jsonStringify(manifest, null, 2),
    {
      encoding: 'utf-8',
      flush: true,
    },
  )
}

export function runLearningPipelineFromFiles(
  input: RunLearningPipelineFromFilesInput,
): RunLearningPipelineFromFilesResult {
  mkdirSync(input.output_dir, { recursive: true })
  const artifacts = artifactPaths(input.output_dir)

  const heuristic_training = trainHeuristicCandidatesFromFiles({
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    base_heuristic_bundle_version: input.base_heuristic_bundle_version,
    rollout_bundle_paths: input.rollout_bundle_paths,
    output_path: artifacts.heuristic_training,
  })

  const polar_training = trainPolarHarnessCandidatesFromFiles({
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    base_harness_version: input.base_harness_version,
    observations_path: input.polar_training_observations_path,
    output_path: artifacts.polar_training,
  })

  writeEvaluationSnapshotFromFiles({
    output_path: artifacts.evaluation_snapshot,
    replay_results_path: input.replay_results_path,
    held_out_rollout_paths: input.held_out_rollout_paths,
    security_scan_path: input.security_scan_path,
    complexity_budget_path: input.complexity_budget_path,
    target_failure_slice_path: input.target_failure_slice_path,
    regressions_path: input.regressions_path,
    polar_spike_observations_path: input.polar_eval_observations_path,
  })

  const promotion_evidence = writePromotionEvidenceFromSnapshotFiles({
    snapshot_path: artifacts.evaluation_snapshot,
    heuristic_output_path: artifacts.heuristic_promotion_evidence,
    polar_output_path: artifacts.polar_promotion_evidence,
  })

  const heuristic_promotion = writeHeuristicPromotionReportFromFiles({
    training_path: artifacts.heuristic_training,
    evidence_path: artifacts.heuristic_promotion_evidence,
    output_path: artifacts.heuristic_promotion_report,
  })

  const polar_promotion = writePolarHarnessPromotionReportFromFiles({
    training_path: artifacts.polar_training,
    evidence_path: artifacts.polar_promotion_evidence,
    output_path: artifacts.polar_promotion_report,
  })

  const status = pipelineStatus(
    heuristic_training,
    polar_training,
    heuristic_promotion,
    polar_promotion,
  )
  const stable_promotion_ready = status === 'ready_for_stable_promotion'
  const manifest: LearningPipelineManifest = {
    schema_version: 'leviathan.learning_pipeline.v1',
    status,
    training_run_id: input.training_run_id,
    provider_model_id: input.provider_model_id,
    provider_model_update: 'none',
    stable_promotion_ready,
    artifacts,
    reports: {
      heuristic_training_status: heuristic_training.training.status,
      polar_training_status: polar_training.training.status,
      heuristic_promotion_status: heuristic_promotion.report.status,
      polar_promotion_status: polar_promotion.report.status,
    },
  }

  writeManifest(manifest)

  return {
    manifest,
    heuristic_training,
    polar_training,
    promotion_evidence,
    heuristic_promotion,
    polar_promotion,
  }
}
