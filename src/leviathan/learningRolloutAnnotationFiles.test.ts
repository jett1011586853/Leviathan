import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'
import { annotateRolloutFile } from '../learning/rolloutAnnotationFiles.js'
import { trainHeuristicCandidatesFromFiles } from '../learning/heuristicTrainingFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-rollout-annotation-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function rawRollout() {
  return createEmptyRolloutBundle({
    runId: 'run_annotate_1',
    sessionId: 'session_annotate_1',
    taskId: 'task_annotate_1',
    source: 'internal',
    split: 'shadow',
    timestamp: '2026-06-04T00:00:00.000Z',
    harnessVersion: 'git:2364464',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'fix a bad tool argument failure',
    repo: 'leviathan',
    baseCommit: '2364464',
    cwdAlias: '$WORKDIR',
  })
}

describe('Leviathan rollout annotation files', () => {
  test('annotates an exported rollout into a trainable HL sample without mutating provider model state', async () => {
    await withTempDir(dir => {
      const inputPath = join(dir, 'raw-rollout.json')
      const outputPath = join(dir, 'annotated-rollout.json')
      const trainingPath = join(dir, 'candidate-heuristics.json')
      writeFileSync(inputPath, JSON.stringify(rawRollout()), 'utf8')

      const result = annotateRolloutFile({
        input_path: inputPath,
        output_path: outputPath,
        split: 'train',
        taxonomy: ['tool_choice_failure.bad_args'],
        root_cause_summary: 'Provider-compatible tool arguments were malformed.',
        final_outcome: 'unresolved',
        resolved_label: false,
        test_commands: ['bun test src\\leviathan\\learningCommand.test.ts'],
        test_outputs: ['expected valid tool args but received malformed args'],
        exit_codes: [1],
        changed_files: ['src/commands/learning/learning.ts'],
        diff: 'diff --git a/src/commands/learning/learning.ts b/src/commands/learning/learning.ts',
        export_allowed: true,
        contains_private_code: false,
      })

      const annotated = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(result.output_path).toBe(outputPath)
      expect(annotated.run.split).toBe('train')
      expect(annotated.failure.taxonomy).toEqual([
        'tool_choice_failure.bad_args',
      ])
      expect(annotated.failure.root_cause_summary).toBe(
        'Provider-compatible tool arguments were malformed.',
      )
      expect(annotated.evaluation.final_outcome).toBe('unresolved')
      expect(annotated.evaluation.resolved_label).toBe(false)
      expect(annotated.evaluation.exit_codes).toEqual([1])
      expect(annotated.evaluation.test_commands).toEqual([
        'bun test src\\leviathan\\learningCommand.test.ts',
      ])
      expect(annotated.code_changes.changed_files).toEqual([
        'src/commands/learning/learning.ts',
      ])
      expect(annotated.security.export_allowed).toBe(true)
      expect(annotated.security.contains_private_code).toBe(false)

      const training = trainHeuristicCandidatesFromFiles({
        training_run_id: 'train_annotation_1',
        provider_model_id: 'mimo-v2.5',
        base_heuristic_bundle_version: 'hb:initial',
        rollout_bundle_paths: [outputPath],
        output_path: trainingPath,
      }).training

      expect(training.status).toBe('candidate_only')
      expect(training.provider_model_update).toBe('none')
      expect(training.candidates[0]?.id).toBe(
        'candidate_tool_choice_failure_001',
      )
    })
  })
})
