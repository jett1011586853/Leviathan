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
  trainPolarHarnessCandidatesFromFiles,
} from '../learning/polarHarnessTrainingFiles.js'
import type { PolarProxySpikeObservation } from '../learning/polarProxySpike.js'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-polar-training-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function observation(
  case_id: PolarProxySpikeObservation['case_id'],
  overrides: Partial<PolarProxySpikeObservation> = {},
): PolarProxySpikeObservation {
  return {
    case_id,
    captured_requests_count: 1,
    leviathan_model_requests_count: 1,
    request_response_pairs_complete: true,
    run_session_binding_complete: true,
    final_outcome_recorded: true,
    streaming_complete: true,
    tool_use_complete: true,
    trajectory_completeness: true,
    replay_fidelity: true,
    reward_binding_success: true,
    causal_chain_model_tool_diff_complete: true,
    test_artifacts_complete: true,
    ...overrides,
  }
}

describe('Leviathan Polar harness training file runner', () => {
  test('writes candidate Polar harness updates from observation files', () => {
    withTempDir(dir => {
      const observationsPath = join(dir, 'polar-observations.json')
      const outputPath = join(dir, 'polar-candidates.json')
      writeFileSync(
        observationsPath,
        JSON.stringify([
          observation('case_a_no_tool', {
            captured_requests_count: 0,
          }),
          observation('case_b_file_read_write'),
          observation('case_c_test_execution'),
        ]),
        'utf8',
      )

      const result = trainPolarHarnessCandidatesFromFiles({
        training_run_id: 'train_20260603_001',
        provider_model_id: 'mimo-v2.5',
        base_harness_version: 'git:abc123',
        observations_path: observationsPath,
        output_path: outputPath,
      })

      expect(result.output_path).toBe(outputPath)
      expect(result.training.status).toBe('candidate_only')
      expect(result.training.provider_model_update).toBe('none')
      expect(result.training.updates.map(update => update.id)).toEqual([
        'polar_candidate_proxy_bypass_001',
      ])
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.training,
      )
    })
  })

  test('writes blocked Polar harness updates when observation files pass', () => {
    withTempDir(dir => {
      const observationsPath = join(dir, 'polar-observations.json')
      const outputPath = join(dir, 'polar-candidates.json')
      writeFileSync(
        observationsPath,
        JSON.stringify([
          observation('case_a_no_tool'),
          observation('case_b_file_read_write'),
          observation('case_c_test_execution'),
        ]),
        'utf8',
      )

      const result = trainPolarHarnessCandidatesFromFiles({
        training_run_id: 'train_clean',
        provider_model_id: 'mimo-v2.5',
        base_harness_version: 'git:abc123',
        observations_path: observationsPath,
        output_path: outputPath,
      })

      expect(result.training.status).toBe('blocked')
      expect(result.training.blocked_reasons).toEqual([
        'polar_spike.no_failed_observations',
      ])
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(
        result.training,
      )
    })
  })
})
