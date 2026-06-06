import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initializeShadowLearningRun } from '../learning/shadowLearningRunFiles.js'
import { writeShadowLearningTaskQueueFile } from '../learning/shadowLearningTaskQueueFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-shadow-task-queue-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Leviathan shadow learning task queue files', () => {
  test('creates a 50-task real rollout collection queue matching split quotas', async () => {
    await withTempDir(dir => {
      const runDir = join(dir, 'train_shadow_001')
      const outputPath = join(runDir, 'task-queue.json')
      initializeShadowLearningRun({
        output_dir: runDir,
        run_id: 'train_shadow_001',
        provider_model_id: 'mimo-v2.5',
        created_at: '2026-06-04T12:00:00.000Z',
        git_commit: '3c2c341',
        rollback_checkpoint_tag: 'permanent-leviathan-current-2026-06-04',
        target_rollout_count: 50,
      })

      const result = writeShadowLearningTaskQueueFile({
        run_dir: runDir,
        output_path: outputPath,
      })

      expect(result.queue.schema_version).toBe(
        'leviathan.shadow_task_queue.v1',
      )
      expect(result.queue.provider_model_update).toBe('none')
      expect(result.queue.tasks).toHaveLength(50)
      expect(result.queue.split_counts).toEqual({
        train: 30,
        dev: 10,
        held_out: 10,
      })
      expect(new Set(result.queue.tasks.map(task => task.task_id)).size).toBe(50)
      expect(result.queue.coverage.taxonomy_classes.length).toBeGreaterThanOrEqual(8)

      const first = result.queue.tasks[0]
      expect(first?.status).toBe('pending')
      expect(first?.split).toBe('train')
      expect(first?.export_command).toContain('/export --rollout')
      expect(first?.export_command).toContain('--run-id train_shadow_001')
      expect(first?.export_command).toContain(
        '--task-id train_shadow_001_train_001',
      )
      expect(first?.export_command).toContain('--split train')
      expect(first?.export_command).toContain('--policy-version mimo-v2.5')
      expect(first?.intake_command).toContain('/learning intake-shadow-rollout')
      expect(first?.intake_command).toContain('--run-dir')
      expect(first?.taxonomy_hint).toContain('.')
      expect(first?.collection_instruction).toContain('Leviathan')
      expect(first?.collection_instruction).toContain(
        'Use only tools that are actually available in the current Leviathan session',
      )
      expect(first?.collection_instruction).toContain(
        'Do not call Glob or Read unless those tools are explicitly available',
      )
      expect(first?.collection_instruction).toContain(
        'Do not treat $WORKDIR as a verified shell variable',
      )
      expect(existsSync(outputPath)).toBe(true)

      const written = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(written.next_actions).toContain(
        'Run the pending tasks with Leviathan, export each rollout, then intake it with the task intake command.',
      )
    })
  })

  test('quotes generated rollout command paths for shell-safe execution', async () => {
    await withTempDir(dir => {
      const runDir = join(dir, 'train shadow 001')
      const outputPath = join(runDir, 'task-queue.json')
      initializeShadowLearningRun({
        output_dir: runDir,
        run_id: 'train_shadow_001',
        provider_model_id: 'mimo-v2.5',
        created_at: '2026-06-04T12:00:00.000Z',
        git_commit: '3c2c341',
        rollback_checkpoint_tag: 'permanent-leviathan-current-2026-06-04',
        target_rollout_count: 50,
      })

      const result = writeShadowLearningTaskQueueFile({
        run_dir: runDir,
        output_path: outputPath,
      })

      const first = result.queue.tasks[0]
      expect(first?.export_command).toContain(
        "--rollout '",
      )
      expect(first?.export_command).toContain('train shadow 001')
      expect(first?.export_command).toContain("--cwd-alias '$WORKDIR'")
      expect(first?.intake_command).toContain("--run-dir '")
      expect(first?.intake_command).toContain("--input '")
      expect(first?.intake_command).toContain("--out '")
    })
  })
})
