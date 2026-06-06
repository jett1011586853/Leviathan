import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { initializeShadowLearningRun } from '../learning/shadowLearningRunFiles.js'
import { writeShadowRootCauseRepairReportFile } from '../learning/shadowRootCauseRepairFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-root-cause-repair-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function oppositeDrivePath(runDir: string): string {
  const drive = resolve(runDir).slice(0, 2).toUpperCase()
  return drive === 'C:'
    ? 'D:\\leviathan-outside-root-cause.json'
    : 'C:\\leviathan-outside-root-cause.json'
}

describe('Leviathan shadow root-cause repair files', () => {
  test('blocks manifest entries that resolve outside the shadow run directory', async () => {
    await withTempDir(dir => {
      const runDir = join(dir, 'train_shadow_001')
      const manifestPath = join(dir, 'root-causes.json')
      const reportPath = join(runDir, 'root-cause-repair.json')
      initializeShadowLearningRun({
        output_dir: runDir,
        run_id: 'train_shadow_001',
        provider_model_id: 'mimo-v2.5',
        created_at: '2026-06-04T12:00:00.000Z',
        git_commit: 'edab200',
        rollback_checkpoint_tag: 'permanent-leviathan-current-2026-06-04',
        target_rollout_count: 50,
      })
      writeFileSync(
        manifestPath,
        JSON.stringify({
          entries: [
            {
              path: oppositeDrivePath(runDir),
              root_cause_summary:
                'This must not be allowed to target files outside the run.',
            },
          ],
        }),
        'utf8',
      )

      const result = writeShadowRootCauseRepairReportFile({
        run_dir: runDir,
        manifest_path: manifestPath,
        output_path: reportPath,
      })
      const report = JSON.parse(readFileSync(result.output_path, 'utf8'))

      expect(report.repaired_count).toBe(0)
      expect(report.blocked_entries).toEqual([
        {
          path: oppositeDrivePath(runDir),
          reason: 'path.outside_run_dir',
        },
      ])
    })
  })
})
