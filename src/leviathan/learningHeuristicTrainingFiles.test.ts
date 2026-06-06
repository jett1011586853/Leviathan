import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  trainHeuristicCandidatesFromFiles,
} from '../learning/heuristicTrainingFiles.js'
import { createEmptyRolloutBundle } from '../learning/rolloutSchema.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-heuristic-training-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeRollout(
  dir: string,
  id: string,
  taxonomy: string[],
  rootCause = `root cause for ${id}`,
): string {
  const bundle = createEmptyRolloutBundle({
    runId: `run_${id}`,
    sessionId: `session_${id}`,
    taskId: `task_${id}`,
    source: 'internal',
    split: 'shadow',
    timestamp: '2026-06-03T00:00:00.000Z',
    harnessVersion: 'git:abc123',
    heuristicBundleVersion: 'hb:initial',
    policyVersion: 'mimo-v2.5',
    userInstruction: 'train candidate heuristics from rollout files',
    repo: 'leviathan',
    baseCommit: 'abc123',
    cwdAlias: '$WORKDIR',
  })
  bundle.failure.taxonomy = taxonomy
  bundle.failure.root_cause_summary = rootCause

  const path = join(dir, `rollout-${id}.json`)
  writeFileSync(path, JSON.stringify(bundle), 'utf8')
  return path
}

describe('Leviathan heuristic training file runner', () => {
  test('writes candidate-only heuristic training results from rollout files', () => {
    withTempDir(dir => {
      const outputPath = join(dir, 'candidate-heuristics.json')
      const result = trainHeuristicCandidatesFromFiles({
        training_run_id: 'train_20260603_001',
        provider_model_id: 'mimo-v2.5',
        base_heuristic_bundle_version: 'hb:initial',
        rollout_bundle_paths: [
          writeRollout(dir, '1', ['tool_choice_failure.bad_args']),
          writeRollout(dir, '2', ['verification_failure.flaky_tests']),
        ],
        output_path: outputPath,
      })

      expect(result.output_path).toBe(outputPath)
      expect(result.training.status).toBe('candidate_only')
      expect(result.training.provider_model_update).toBe('none')
      expect(result.training.stable_promotions_allowed).toBe(false)
      expect(result.training.candidates.map(candidate => candidate.id)).toEqual([
        'candidate_tool_choice_failure_001',
        'candidate_verification_failure_001',
      ])
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.training,
      )
    })
  })

  test('writes blocked training results when rollout files lack trainable failures', () => {
    withTempDir(dir => {
      const outputPath = join(dir, 'candidate-heuristics.json')
      const result = trainHeuristicCandidatesFromFiles({
        training_run_id: 'train_blocked',
        provider_model_id: 'mimo-v2.5',
        base_heuristic_bundle_version: 'hb:initial',
        rollout_bundle_paths: [writeRollout(dir, '1', [])],
        output_path: outputPath,
      })

      expect(result.training.status).toBe('blocked')
      expect(result.training.candidates).toEqual([])
      expect(result.training.blocked_reasons).toEqual([
        'rollouts.no_trainable_failure_taxonomy',
      ])
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.training,
      )
    })
  })

  test('writes blocked training results when trainable rollout files lack root-cause summaries', () => {
    withTempDir(dir => {
      const outputPath = join(dir, 'candidate-heuristics.json')
      const result = trainHeuristicCandidatesFromFiles({
        training_run_id: 'train_missing_root_cause',
        provider_model_id: 'mimo-v2.5',
        base_heuristic_bundle_version: 'hb:initial',
        rollout_bundle_paths: [
          writeRollout(dir, '1', ['tool_choice_failure.bad_args'], ''),
        ],
        output_path: outputPath,
      })

      expect(result.training.status).toBe('blocked')
      expect(result.training.candidates).toEqual([])
      expect(result.training.blocked_reasons).toEqual([
        'rollouts.missing_root_cause_summary',
      ])
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.training,
      )
    })
  })
})
