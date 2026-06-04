import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initializeShadowLearningRun } from '../learning/shadowLearningRunFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-shadow-learning-run-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Leviathan shadow learning run files', () => {
  test('initializes a collecting shadow run without starting formal training', async () => {
    await withTempDir(dir => {
      const outputDir = join(dir, 'train_shadow_001')
      const result = initializeShadowLearningRun({
        output_dir: outputDir,
        run_id: 'train_shadow_001',
        provider_model_id: 'mimo-v2.5',
        created_at: '2026-06-04T12:00:00.000Z',
        git_commit: '7546f5e',
        rollback_checkpoint_tag: 'permanent-leviathan-current-2026-06-04',
        cwd_alias: '$WORKDIR',
        target_rollout_count: 50,
      })

      expect(result.run.status).toBe('collecting_rollouts')
      expect(result.run.provider_model_update).toBe('none')
      expect(result.run.target_rollout_count).toBe(50)
      expect(result.run.split_plan).toEqual({
        train: 30,
        dev: 10,
        held_out: 10,
      })
      expect(result.formal_manifest.status).toBe('blocked')
      expect(result.formal_manifest.launch).toBeNull()
      expect(result.formal_manifest.blocked?.failed_checks).toContain(
        'required_fields_landable',
      )
      expect(result.formal_manifest.blocked?.failed_checks).toContain(
        'replay_runner_fixed_task_reproducible',
      )
      expect(result.formal_manifest.blocked?.failed_checks).not.toContain(
        'concept_boundaries_fixed',
      )
      expect(result.formal_manifest.blocked?.failed_checks).not.toContain(
        'rollout_schema_v1_implemented',
      )

      for (const path of [
        result.paths.launch_config,
        result.paths.formal_manifest,
        result.paths.shadow_manifest,
        result.paths.raw_rollouts_dir,
        result.paths.annotated_train_dir,
        result.paths.annotated_dev_dir,
        result.paths.annotated_held_out_dir,
        result.paths.evidence_dir,
        result.paths.pipeline_dir,
      ]) {
        expect(existsSync(path)).toBe(true)
      }

      const launchConfig = JSON.parse(
        readFileSync(result.paths.launch_config, 'utf8'),
      )
      expect(launchConfig.provider_model_id).toBe('mimo-v2.5')
      expect(launchConfig.rollout_bundle_count).toBe(0)
      expect(launchConfig.rollback_checkpoint_tag).toBe(
        'permanent-leviathan-current-2026-06-04',
      )

      const shadowManifest = JSON.parse(
        readFileSync(result.paths.shadow_manifest, 'utf8'),
      )
      expect(shadowManifest.schema_version).toBe(
        'leviathan.shadow_learning_run.v1',
      )
      expect(shadowManifest.next_actions).toContain(
        'Collect and export redacted rollout bundles into rollouts/raw.',
      )
    })
  })
})
