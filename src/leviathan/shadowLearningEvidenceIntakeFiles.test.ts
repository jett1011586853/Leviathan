import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initializeShadowLearningRun } from '../learning/shadowLearningRunFiles.js'
import { intakeShadowEvidenceFile } from '../learning/shadowLearningEvidenceIntakeFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-shadow-evidence-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Leviathan shadow evidence intake files', () => {
  test('copies required evidence into the standard run directory and refreshes status', async () => {
    await withTempDir(dir => {
      const runDir = join(dir, 'train_shadow_001')
      const sourcePath = join(dir, 'replay-results-input.json')
      initializeShadowLearningRun({
        output_dir: runDir,
        run_id: 'train_shadow_001',
        provider_model_id: 'mimo-v2.5',
        created_at: '2026-06-04T12:00:00.000Z',
        git_commit: '3bac081',
        rollback_checkpoint_tag: 'permanent-leviathan-current-2026-06-04',
        target_rollout_count: 50,
      })
      writeFileSync(
        sourcePath,
        JSON.stringify([{ status: 'completed', blockers: [], compare_passed: true }]),
        'utf8',
      )

      const result = intakeShadowEvidenceFile({
        run_dir: runDir,
        input_path: sourcePath,
        kind: 'replay-results',
      })

      expect(result.report.schema_version).toBe(
        'leviathan.shadow_evidence_intake.v1',
      )
      expect(result.report.provider_model_update).toBe('none')
      expect(result.report.evidence_path).toBe(
        join(runDir, 'evidence', 'replay-results.json'),
      )
      expect(existsSync(result.report.evidence_path)).toBe(true)

      const copied = JSON.parse(readFileSync(result.report.evidence_path, 'utf8'))
      const status = JSON.parse(
        readFileSync(join(runDir, 'shadow-status.json'), 'utf8'),
      )
      expect(copied).toEqual([
        { status: 'completed', blockers: [], compare_passed: true },
      ])
      expect(status.evidence.present_files).toContain('replay-results.json')
      expect(status.evidence.missing_files).not.toContain('replay-results.json')
      expect(status.evidence.missing_files).toContain('reward-design.json')
    })
  })
})
