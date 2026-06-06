import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadActiveLearningRuntimeContextFromFile,
  renderActiveLearningRuntimeContext,
} from '../learning/activeLearningContext.js'
import type { LearningActivationState } from '../learning/learningActivationFiles.js'
import type { LearningBundle } from '../learning/learningBundleFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-active-learning-context-'))
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

function learningBundle(overrides: Partial<LearningBundle> = {}): LearningBundle {
  return {
    schema_version: 'leviathan.learning_bundle.v1',
    status: 'ready_for_activation',
    training_run_id: 'train_runtime_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    stable_activation_allowed: true,
    heuristic_bundle: {
      version: 'hb:stable/train_runtime_1',
      source_candidate_bundle_version: 'hb:candidate/train_runtime_1',
      candidates: [
        {
          id: 'candidate_tool_choice_failure_001',
          type: 'candidate tool policy',
          status: 'candidate',
          source_failure_taxonomy: ['tool_choice_failure.bad_args'],
          learned_guidance: [
            'Before emitting a tool call, verify the tool name is present in the current available tool set.',
          ],
          feature_flag: 'hl.candidate.tool_choice_failure_001',
          rollback_plan:
            'Disable feature flag hl.candidate.tool_choice_failure_001',
        },
      ],
    },
    polar_harness: {
      version: 'polar:stable/train_runtime_1',
      source_candidate_harness_version: 'polar:candidate/train_runtime_1',
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

function activationState(bundlePath: string): LearningActivationState {
  return {
    schema_version: 'leviathan.learning_activation.v1',
    status: 'active',
    active_bundle_path: bundlePath,
    activated_at: '2026-06-04T12:00:00.000Z',
    activated_by: 'slash-command',
    training_run_id: 'train_runtime_1',
    provider_model_id: 'mimo-v2.5',
    provider_model_update: 'none',
    heuristic_bundle_version: 'hb:stable/train_runtime_1',
    polar_harness_version: 'polar:stable/train_runtime_1',
    enabled_feature_flags: [
      'hl.candidate.tool_choice_failure_001',
      'polar.candidate.proxy_bypass_001',
    ],
    rollback_plans: [
      'Disable feature flag hl.candidate.tool_choice_failure_001',
      'Disable feature flag polar.candidate.proxy_bypass_001',
    ],
    previous: null,
    blocked_reasons: [],
  }
}

describe('Leviathan active learning runtime context', () => {
  test('loads an active bundle into model-visible harness learning context', async () => {
    await withTempDir(dir => {
      const bundlePath = writeJson(dir, 'learning-bundle.json', learningBundle())
      const statePath = writeJson(dir, 'active-learning.json', activationState(bundlePath))

      const context = loadActiveLearningRuntimeContextFromFile({ state_path: statePath })

      expect(context?.provider_model_id).toBe('mimo-v2.5')
      expect(context?.provider_model_update).toBe('none')
      expect(context?.training_run_id).toBe('train_runtime_1')
      expect(context?.heuristic_candidates.map(candidate => candidate.id)).toEqual([
        'candidate_tool_choice_failure_001',
      ])
      expect(context?.heuristic_candidates[0]?.learned_guidance).toEqual([
        'Before emitting a tool call, verify the tool name is present in the current available tool set.',
      ])
      expect(context?.polar_updates.map(update => update.id)).toEqual([
        'polar_candidate_proxy_bypass_001',
      ])

      const rendered = renderActiveLearningRuntimeContext(context)
      expect(rendered).toContain('# Leviathan Active Learning')
      expect(rendered).toContain('Provider model update: none')
      expect(rendered).toContain('hb:stable/train_runtime_1')
      expect(rendered).toContain('polar:stable/train_runtime_1')
      expect(rendered).toContain('candidate_tool_choice_failure_001')
      expect(rendered).toContain('verify the tool name is present')
      expect(rendered).toContain('polar_candidate_proxy_bypass_001')
      expect(rendered).not.toContain(dir)
      expect(rendered).not.toContain(bundlePath)
      expect(rendered).not.toContain(statePath)
    })
  })

  test('does not expose blocked activation state to runtime context', async () => {
    await withTempDir(dir => {
      const bundlePath = writeJson(dir, 'learning-bundle.json', learningBundle())
      const statePath = writeJson(dir, 'active-learning.json', {
        ...activationState(bundlePath),
        status: 'blocked',
        blocked_reasons: ['bundle.status.blocked'],
      })

      expect(loadActiveLearningRuntimeContextFromFile({ state_path: statePath })).toBeNull()
    })
  })

  test('does not expose mismatched active state and bundle versions', async () => {
    await withTempDir(dir => {
      const bundlePath = writeJson(
        dir,
        'learning-bundle.json',
        learningBundle({
          heuristic_bundle: {
            ...learningBundle().heuristic_bundle,
            version: 'hb:stable/different',
          },
        }),
      )
      const statePath = writeJson(dir, 'active-learning.json', activationState(bundlePath))

      expect(loadActiveLearningRuntimeContextFromFile({ state_path: statePath })).toBeNull()
    })
  })
})
