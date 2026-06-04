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
  activateLearningBundleFromFiles,
  rollbackLearningActivationFile,
} from '../learning/learningActivationFiles.js'
import type { LearningBundle } from '../learning/learningBundleFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-learning-activation-'))
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

function learningBundle(
  overrides: Partial<LearningBundle> = {},
): LearningBundle {
  return {
    schema_version: 'leviathan.learning_bundle.v1',
    status: 'ready_for_activation',
    training_run_id: 'train_activation_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    stable_activation_allowed: true,
    heuristic_bundle: {
      version: 'hb:stable/train_activation_1',
      source_candidate_bundle_version: 'hb:candidate/train_activation_1',
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
    },
    polar_harness: {
      version: 'polar:stable/train_activation_1',
      source_candidate_harness_version: 'polar:candidate/train_activation_1',
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
    },
    rollback: {
      feature_flags: [
        'hl.candidate.tool_choice_failure_001',
        'polar.candidate.proxy_bypass_001',
      ],
      plans: [
        'Disable feature flag hl.candidate.tool_choice_failure_001',
        'Disable feature flag polar.candidate.proxy_bypass_001',
      ],
    },
    blocked_reasons: [],
    ...overrides,
  }
}

describe('Leviathan learning activation files', () => {
  test('activates a ready learning bundle into local harness learning state', async () => {
    await withTempDir(dir => {
      const bundlePath = writeJson(dir, 'learning-bundle.json', learningBundle())
      const statePath = join(dir, 'active-learning.json')

      const result = activateLearningBundleFromFiles({
        bundle_path: bundlePath,
        state_path: statePath,
        activated_at: '2026-06-04T12:00:00.000Z',
        activated_by: 'slash-command',
      })

      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      expect(result.state.status).toBe('active')
      expect(state.schema_version).toBe('leviathan.learning_activation.v1')
      expect(state.status).toBe('active')
      expect(state.active_bundle_path).toBe(bundlePath)
      expect(state.training_run_id).toBe('train_activation_1')
      expect(state.provider_model_update).toBe('none')
      expect(state.heuristic_bundle_version).toBe(
        'hb:stable/train_activation_1',
      )
      expect(state.polar_harness_version).toBe(
        'polar:stable/train_activation_1',
      )
      expect(state.enabled_feature_flags).toEqual([
        'hl.candidate.tool_choice_failure_001',
        'polar.candidate.proxy_bypass_001',
      ])
      expect(state.previous).toBe(null)
      expect(state.blocked_reasons).toEqual([])
    })
  })

  test('blocks activation for non-ready bundles without replacing current state', async () => {
    await withTempDir(dir => {
      const statePath = join(dir, 'active-learning.json')
      writeFileSync(
        statePath,
        JSON.stringify({
          schema_version: 'leviathan.learning_activation.v1',
          status: 'active',
          active_bundle_path: 'previous.json',
          activated_at: '2026-06-04T10:00:00.000Z',
          activated_by: 'slash-command',
          training_run_id: 'train_previous',
          provider_model_id: 'mimo-v2.5',
          provider_model_update: 'none',
          heuristic_bundle_version: 'hb:stable/train_previous',
          polar_harness_version: 'polar:stable/train_previous',
          enabled_feature_flags: ['hl.candidate.previous'],
          rollback_plans: ['Disable feature flag hl.candidate.previous'],
          previous: null,
          blocked_reasons: [],
        }),
        'utf8',
      )
      const bundlePath = writeJson(
        dir,
        'blocked-bundle.json',
        learningBundle({
          status: 'blocked',
          stable_activation_allowed: false,
          blocked_reasons: ['heuristic_report.status.rejected'],
        }),
      )

      const result = activateLearningBundleFromFiles({
        bundle_path: bundlePath,
        state_path: statePath,
        activated_at: '2026-06-04T12:00:00.000Z',
        activated_by: 'slash-command',
      })

      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      expect(result.state.status).toBe('blocked')
      expect(result.state.blocked_reasons).toContain('bundle.status.blocked')
      expect(result.state.blocked_reasons).toContain(
        'heuristic_report.status.rejected',
      )
      expect(state.training_run_id).toBe('train_previous')
      expect(state.enabled_feature_flags).toEqual(['hl.candidate.previous'])
    })
  })

  test('rolls back to the previous active learning state', async () => {
    await withTempDir(dir => {
      const statePath = join(dir, 'active-learning.json')
      const firstBundlePath = writeJson(
        dir,
        'first-bundle.json',
        learningBundle({
          training_run_id: 'train_first',
          heuristic_bundle: {
            ...learningBundle().heuristic_bundle,
            version: 'hb:stable/train_first',
          },
          polar_harness: {
            ...learningBundle().polar_harness,
            version: 'polar:stable/train_first',
          },
        }),
      )
      const secondBundlePath = writeJson(
        dir,
        'second-bundle.json',
        learningBundle({
          training_run_id: 'train_second',
          heuristic_bundle: {
            ...learningBundle().heuristic_bundle,
            version: 'hb:stable/train_second',
          },
          polar_harness: {
            ...learningBundle().polar_harness,
            version: 'polar:stable/train_second',
          },
        }),
      )

      activateLearningBundleFromFiles({
        bundle_path: firstBundlePath,
        state_path: statePath,
        activated_at: '2026-06-04T10:00:00.000Z',
        activated_by: 'slash-command',
      })
      activateLearningBundleFromFiles({
        bundle_path: secondBundlePath,
        state_path: statePath,
        activated_at: '2026-06-04T12:00:00.000Z',
        activated_by: 'slash-command',
      })

      const result = rollbackLearningActivationFile({
        state_path: statePath,
        rolled_back_at: '2026-06-04T13:00:00.000Z',
      })

      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      expect(result.state.status).toBe('active')
      expect(state.training_run_id).toBe('train_first')
      expect(state.heuristic_bundle_version).toBe('hb:stable/train_first')
      expect(state.polar_harness_version).toBe('polar:stable/train_first')
      expect(state.previous).toBe(null)
      expect(result.rolled_back_from?.training_run_id).toBe('train_second')
    })
  })
})
