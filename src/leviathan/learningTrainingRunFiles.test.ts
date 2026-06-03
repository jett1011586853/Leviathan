import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  launchTrainingRunFromConfigFile,
  type TrainingLaunchConfigFile,
} from '../learning/trainingRunFiles.js'
import {
  TRAINING_READINESS_CHECKS,
  type TrainingReadinessEvidence,
} from '../learning/trainingReadiness.js'

function allReadyEvidence(
  overrides: Partial<TrainingReadinessEvidence> = {},
): TrainingReadinessEvidence {
  return {
    ...(Object.fromEntries(
      TRAINING_READINESS_CHECKS.map(check => [check.id, true]),
    ) as TrainingReadinessEvidence),
    ...overrides,
  }
}

function configFile(
  overrides: Partial<TrainingLaunchConfigFile> = {},
): TrainingLaunchConfigFile {
  return {
    provider_model_id: 'mimo-v2.5',
    policy_trainability: 'closed_api',
    readiness_evidence: allReadyEvidence(),
    baseline_matrix: {
      policy_trainability: 'closed_api',
      enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
    },
    rollout_bundle_count: 128,
    cwd_alias: '$WORKDIR',
    git_commit: 'abc123',
    rollback_checkpoint_tag: 'checkpoint/hl-polar-readiness-foundation-v1.0',
    ...overrides,
  }
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-training-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Leviathan training run file launcher', () => {
  test('writes a started training manifest from a ready launch config', () => {
    withTempDir(dir => {
      const configPath = join(dir, 'launch.json')
      const outputPath = join(dir, 'manifest.json')
      writeFileSync(configPath, JSON.stringify(configFile()), 'utf8')

      const result = launchTrainingRunFromConfigFile({
        config_path: configPath,
        output_path: outputPath,
        run_id: 'train_20260603_001',
        created_at: '2026-06-03T12:00:00.000Z',
      })

      expect(result.manifest.status).toBe('started')
      expect(result.manifest.launch?.mode).toBe('hl_polar_harness_learning')
      expect(result.manifest.launch?.provider_model_update).toBe('none')
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.manifest,
      )
    })
  })

  test('writes a blocked manifest when readiness evidence is incomplete', () => {
    withTempDir(dir => {
      const configPath = join(dir, 'launch.json')
      const outputPath = join(dir, 'manifest.json')
      writeFileSync(
        configPath,
        JSON.stringify(
          configFile({
            readiness_evidence: allReadyEvidence({
              replay_runner_fixed_task_reproducible: false,
            }),
          }),
        ),
        'utf8',
      )

      const result = launchTrainingRunFromConfigFile({
        config_path: configPath,
        output_path: outputPath,
        run_id: 'train_20260603_002',
        created_at: '2026-06-03T12:10:00.000Z',
      })

      expect(result.manifest.status).toBe('blocked')
      expect(result.manifest.launch).toBe(null)
      expect(result.manifest.blocked).toEqual({
        failed_checks: ['replay_runner_fixed_task_reproducible'],
        reasons: ['readiness.replay_runner_fixed_task_reproducible'],
      })
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.manifest,
      )
    })
  })
})
