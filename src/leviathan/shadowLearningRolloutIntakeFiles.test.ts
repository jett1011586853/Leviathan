import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'
import { initializeShadowLearningRun } from '../learning/shadowLearningRunFiles.js'
import { intakeShadowRolloutFile } from '../learning/shadowLearningRolloutIntakeFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-shadow-intake-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function rawRollout() {
  return createEmptyRolloutBundle({
    runId: 'run_intake_001',
    sessionId: 'session_intake_001',
    taskId: 'task_intake_001',
    source: 'internal',
    split: 'shadow',
    timestamp: '2026-06-04T14:00:00.000Z',
    harnessVersion: 'git:edab200',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'repair a wrong tool call in a local code task',
    repo: 'leviathan',
    baseCommit: 'edab200',
    cwdAlias: '$WORKDIR',
  })
}

describe('Leviathan shadow rollout intake files', () => {
  test('copies a real exported rollout into raw storage and writes annotated split sample', async () => {
    await withTempDir(dir => {
      const runDir = join(dir, 'train_shadow_001')
      const sourcePath = join(dir, 'exported-rollout.json')
      initializeShadowLearningRun({
        output_dir: runDir,
        run_id: 'train_shadow_001',
        provider_model_id: 'mimo-v2.5',
        created_at: '2026-06-04T12:00:00.000Z',
        git_commit: 'edab200',
        rollback_checkpoint_tag: 'permanent-leviathan-current-2026-06-04',
        target_rollout_count: 50,
      })
      writeFileSync(sourcePath, JSON.stringify(rawRollout()), 'utf8')

      const result = intakeShadowRolloutFile({
        run_dir: runDir,
        input_path: sourcePath,
        split: 'train',
        taxonomy: ['tool_choice_failure.bad_args'],
        root_cause_summary: 'The connected model selected a tool with malformed arguments.',
        final_outcome: 'unresolved',
        resolved_label: false,
        test_commands: ['bun test src\\leviathan\\learningCommand.test.ts'],
        test_outputs: ['tool arguments did not match the schema'],
        exit_codes: [1],
        changed_files: ['src/commands/learning/learning.ts'],
        diff: 'diff --git a/src/commands/learning/learning.ts b/src/commands/learning/learning.ts',
        export_allowed: true,
        contains_private_code: false,
      })

      expect(result.report.schema_version).toBe(
        'leviathan.shadow_rollout_intake.v1',
      )
      expect(result.report.provider_model_update).toBe('none')
      expect(result.report.raw_path).toContain(join('rollouts', 'raw'))
      expect(result.report.annotated_path).toContain(
        join('rollouts', 'annotated', 'train'),
      )
      expect(existsSync(result.report.raw_path)).toBe(true)
      expect(existsSync(result.report.annotated_path ?? '')).toBe(true)

      const raw = JSON.parse(readFileSync(result.report.raw_path, 'utf8'))
      const annotated = JSON.parse(
        readFileSync(result.report.annotated_path ?? '', 'utf8'),
      )
      const status = JSON.parse(
        readFileSync(join(runDir, 'shadow-status.json'), 'utf8'),
      )
      expect(raw.run.split).toBe('shadow')
      expect(annotated.run.split).toBe('train')
      expect(annotated.failure.taxonomy).toEqual([
        'tool_choice_failure.bad_args',
      ])
      expect(annotated.security.export_allowed).toBe(true)
      expect(status.rollout_counts.raw).toBe(1)
      expect(status.rollout_counts.annotated.train).toBe(1)
      expect(status.provider_model_update).toBe('none')
    })
  })
})
