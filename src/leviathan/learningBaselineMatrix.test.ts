import { describe, expect, test } from 'bun:test'

import {
  BASELINE_EXPERIMENT_ARMS,
  validateBaselineMatrix,
} from '../learning/baselineMatrix.js'

describe('Leviathan baseline experiment matrix', () => {
  test('defines the four required v1.0 experiment arms', () => {
    expect(BASELINE_EXPERIMENT_ARMS).toEqual([
      {
        id: 'baseline',
        harness: 'original',
        heuristics: 'original',
        policy: 'original',
        requires_trainable_policy: false,
      },
      {
        id: 'hl_only',
        harness: 'leviathan',
        heuristics: 'upgraded',
        policy: 'original',
        requires_trainable_policy: false,
      },
      {
        id: 'polar_only',
        harness: 'leviathan_black_box',
        heuristics: 'original',
        policy: 'polar_trained',
        requires_trainable_policy: true,
      },
      {
        id: 'hl_polar',
        harness: 'leviathan_with_heuristics',
        heuristics: 'upgraded',
        policy: 'polar_trained',
        requires_trainable_policy: true,
      },
    ])
  })

  test('accepts the matrix for trainable policy experiments', () => {
    expect(
      validateBaselineMatrix({
        policy_trainability: 'trainable',
        enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
      }),
    ).toEqual({
      valid: true,
      missing_arms: [],
      invalid_arms: [],
      warnings: [],
    })
  })

  test('rejects missing required experiment arms', () => {
    expect(
      validateBaselineMatrix({
        policy_trainability: 'trainable',
        enabled_arms: ['baseline', 'hl_only'],
      }),
    ).toEqual({
      valid: false,
      missing_arms: ['polar_only', 'hl_polar'],
      invalid_arms: [],
      warnings: [],
    })
  })

  test('blocks Polar parameter-training arms for closed API policies', () => {
    expect(
      validateBaselineMatrix({
        policy_trainability: 'closed_api',
        enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
      }),
    ).toEqual({
      valid: false,
      missing_arms: [],
      invalid_arms: ['polar_only', 'hl_polar'],
      warnings: [
        'Closed API policies can use Polar instrumentation/evaluation, not parameter-training arms.',
      ],
    })
  })

  test('allows closed API experiments when only baseline and HL-only arms are enabled', () => {
    expect(
      validateBaselineMatrix({
        policy_trainability: 'closed_api',
        enabled_arms: ['baseline', 'hl_only'],
      }),
    ).toEqual({
      valid: true,
      missing_arms: [],
      invalid_arms: [],
      warnings: [
        'Closed API policy matrix omits Polar training arms by design.',
      ],
    })
  })
})
