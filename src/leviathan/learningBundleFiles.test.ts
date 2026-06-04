import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeLearningBundleFromFiles } from '../learning/learningBundleFiles.js'
import type { HeuristicTrainingResult } from '../learning/heuristicTrainer.js'
import type { HeuristicPromotionReport } from '../learning/promotionFiles.js'
import type { PolarHarnessTrainingResult } from '../learning/polarHarnessTrainer.js'
import type { PolarHarnessPromotionReport } from '../learning/polarHarnessPromotionFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-learning-bundle-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value), 'utf8')
  return path
}

function heuristicTraining(): HeuristicTrainingResult {
  return {
    schema_version: 'leviathan.heuristic_training.v1',
    status: 'candidate_only',
    training_run_id: 'train_bundle_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    base_heuristic_bundle_version: 'hb:initial',
    candidate_heuristic_bundle_version: 'hb:candidate/train_bundle_1',
    stable_promotions_allowed: false,
    trained_failure_classes: ['tool_choice_failure'],
    candidates: [
      {
        id: 'candidate_tool_choice_failure_001',
        type: 'candidate tool policy',
        status: 'candidate',
        source_failure_taxonomy: ['tool_choice_failure.bad_args'],
        feature_flag: 'hl.candidate.tool_choice_failure_001',
        rollback_plan:
          'Disable feature flag hl.candidate.tool_choice_failure_001',
      },
    ],
    blocked_reasons: [],
  }
}

function heuristicReport(
  status: HeuristicPromotionReport['status'] = 'ready_for_stable_promotion',
): HeuristicPromotionReport {
  return {
    schema_version: 'leviathan.heuristic_promotion_report.v1',
    status,
    training_run_id: 'train_bundle_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    source_candidate_bundle_version: 'hb:candidate/train_bundle_1',
    stable_promotions_allowed: status === 'ready_for_stable_promotion',
    decisions:
      status === 'ready_for_stable_promotion'
        ? [
            {
              candidate_id: 'candidate_tool_choice_failure_001',
              decision: 'promote',
              stable_allowed: true,
              reasons: [],
            },
          ]
        : [],
    blocked_reasons: status === 'blocked' ? ['training.status.blocked'] : [],
  }
}

function polarTraining(): PolarHarnessTrainingResult {
  return {
    schema_version: 'leviathan.polar_harness_training.v1',
    status: 'candidate_only',
    training_run_id: 'train_bundle_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    base_harness_version: 'git:eb72c45',
    candidate_harness_version: 'polar:candidate/train_bundle_1',
    stable_promotions_allowed: false,
    trained_failure_attributions: ['proxy_bypass'],
    updates: [
      {
        id: 'polar_candidate_proxy_bypass_001',
        status: 'candidate',
        failure_attribution: 'proxy_bypass',
        target_harness_asset: 'model_request_capture',
        source_cases: ['case_a_no_tool'],
        feature_flag: 'polar.candidate.proxy_bypass_001',
        rollback_plan: 'Disable feature flag polar.candidate.proxy_bypass_001',
      },
    ],
    blocked_reasons: [],
  }
}

function polarReport(
  status: PolarHarnessPromotionReport['status'] = 'ready_for_stable_promotion',
): PolarHarnessPromotionReport {
  return {
    schema_version: 'leviathan.polar_harness_promotion_report.v1',
    status,
    training_run_id: 'train_bundle_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    source_candidate_harness_version: 'polar:candidate/train_bundle_1',
    stable_promotions_allowed: status === 'ready_for_stable_promotion',
    decisions:
      status === 'ready_for_stable_promotion'
        ? [
            {
              update_id: 'polar_candidate_proxy_bypass_001',
              decision: 'promote',
              stable_allowed: true,
              reasons: [],
            },
          ]
        : [],
    blocked_reasons: status === 'blocked' ? ['training.status.blocked'] : [],
  }
}

describe('Leviathan learning bundle files', () => {
  test('writes a ready activation bundle from promoted heuristic and Polar reports', async () => {
    await withTempDir(dir => {
      const outputPath = join(dir, 'learning-bundle.json')
      const result = writeLearningBundleFromFiles({
        heuristic_training_path: writeJson(
          dir,
          'heuristic-candidates.json',
          heuristicTraining(),
        ),
        heuristic_promotion_report_path: writeJson(
          dir,
          'heuristic-report.json',
          heuristicReport(),
        ),
        polar_training_path: writeJson(dir, 'polar-candidates.json', polarTraining()),
        polar_promotion_report_path: writeJson(
          dir,
          'polar-report.json',
          polarReport(),
        ),
        output_path: outputPath,
      })

      const bundle = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(result.bundle.status).toBe('ready_for_activation')
      expect(bundle.schema_version).toBe('leviathan.learning_bundle.v1')
      expect(bundle.provider_model_id).toBe('mimo-v2.5')
      expect(bundle.provider_model_update).toBe('none')
      expect(bundle.stable_activation_allowed).toBe(true)
      expect(bundle.heuristic_bundle.version).toBe('hb:stable/train_bundle_1')
      expect(bundle.heuristic_bundle.candidates.map((candidate: { id: string }) => candidate.id)).toEqual([
        'candidate_tool_choice_failure_001',
      ])
      expect(bundle.polar_harness.version).toBe('polar:stable/train_bundle_1')
      expect(bundle.polar_harness.updates.map((update: { id: string }) => update.id)).toEqual([
        'polar_candidate_proxy_bypass_001',
      ])
      expect(bundle.rollback.feature_flags).toEqual([
        'hl.candidate.tool_choice_failure_001',
        'polar.candidate.proxy_bypass_001',
      ])
    })
  })

  test('blocks bundle activation when a promotion report is not ready', async () => {
    await withTempDir(dir => {
      const outputPath = join(dir, 'learning-bundle.json')
      const result = writeLearningBundleFromFiles({
        heuristic_training_path: writeJson(
          dir,
          'heuristic-candidates.json',
          heuristicTraining(),
        ),
        heuristic_promotion_report_path: writeJson(
          dir,
          'heuristic-report.json',
          heuristicReport('rejected'),
        ),
        polar_training_path: writeJson(dir, 'polar-candidates.json', polarTraining()),
        polar_promotion_report_path: writeJson(
          dir,
          'polar-report.json',
          polarReport(),
        ),
        output_path: outputPath,
      })

      expect(result.bundle.status).toBe('blocked')
      expect(result.bundle.stable_activation_allowed).toBe(false)
      expect(result.bundle.heuristic_bundle.candidates).toEqual([])
      expect(result.bundle.polar_harness.updates).toEqual([])
      expect(result.bundle.blocked_reasons).toContain(
        'heuristic_report.status.rejected',
      )
    })
  })
})
