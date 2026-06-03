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
        policy: 'provider_model',
        training_target: 'none',
        requires_trainable_policy: false,
      },
      {
        id: 'hl_only',
        harness: 'leviathan',
        heuristics: 'upgraded',
        policy: 'provider_model',
        training_target: 'hl_harness',
        requires_trainable_policy: false,
      },
      {
        id: 'polar_only',
        harness: 'leviathan_black_box',
        heuristics: 'original',
        policy: 'provider_model',
        training_target: 'polar_harness',
        requires_trainable_policy: false,
      },
      {
        id: 'hl_polar',
        harness: 'leviathan_with_heuristics',
        heuristics: 'upgraded',
        policy: 'provider_model',
        training_target: 'hl_polar_harness',
        requires_trainable_policy: false,
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

  test('allows closed API experiments because Polar is harness-side training', () => {
    expect(
      validateBaselineMatrix({
        policy_trainability: 'closed_api',
        enabled_arms: ['baseline', 'hl_only', 'polar_only', 'hl_polar'],
      }),
    ).toEqual({
      valid: true,
      missing_arms: [],
      invalid_arms: [],
      warnings: [
        'Closed API policy matrix keeps the provider model fixed and trains only harness-side assets.',
      ],
    })
  })

  test('rejects closed API experiments that omit Polar harness arms', () => {
    expect(
      validateBaselineMatrix({
        policy_trainability: 'closed_api',
        enabled_arms: ['baseline', 'hl_only'],
      }),
    ).toEqual({
      valid: false,
      missing_arms: ['polar_only', 'hl_polar'],
      invalid_arms: [],
      warnings: [
        'Closed API policy matrix keeps the provider model fixed and trains only harness-side assets.',
      ],
    })
  })
})
