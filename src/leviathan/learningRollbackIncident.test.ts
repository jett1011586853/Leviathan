import { describe, expect, test } from 'bun:test'

import {
  validateRollbackIncidentPlan,
  type RollbackIncidentPlan,
} from '../learning/rollbackIncidentPlan.js'

function validPlan(): RollbackIncidentPlan {
  return {
    permanent_checkpoint_tag: 'checkpoint/pre-hl-polar-training-v1.0',
    rollback_commands: [
      'git switch main',
      'git reset --hard checkpoint/pre-hl-polar-training-v1.0',
    ],
    feature_flags: [
      'hl.rollout_export.enabled',
      'hl.promotion_gate.enabled',
      'polar.proxy_spike.enabled',
    ],
    incident_owner: 'Leviathan maintainer',
    incident_channels: ['local-runbook', 'github-issue'],
    severity_routes: {
      p0: 'Stop training, disable all HL/Polar flags, rotate exposed secrets, restore checkpoint.',
      p1: 'Pause candidate promotion, run replay suite, rollback affected feature flag.',
      p2: 'File issue, keep shadow mode, review next maintenance window.',
    },
    covers: {
      secret_leak: true,
      benchmark_leak: true,
      reward_hacking: true,
      data_corruption: true,
      regression_spike: true,
    },
  }
}

describe('Leviathan rollback and incident plan gate', () => {
  test('accepts a complete rollback and incident plan', () => {
    expect(validateRollbackIncidentPlan(validPlan())).toEqual({
      valid: true,
      reasons: [],
    })
  })

  test('rejects plans without the permanent pre-training checkpoint rollback', () => {
    const plan = validPlan()
    plan.permanent_checkpoint_tag = 'temporary/tag'
    plan.rollback_commands = ['git switch main']

    expect(validateRollbackIncidentPlan(plan)).toEqual({
      valid: false,
      reasons: [
        'permanent_checkpoint_tag',
        'rollback_commands.hard_reset_checkpoint',
      ],
    })
  })

  test('rejects plans without feature flag rollback and incident routing', () => {
    const plan = validPlan()
    plan.feature_flags = []
    plan.incident_owner = ''
    plan.incident_channels = []
    plan.severity_routes.p0 = ''
    plan.severity_routes.p1 = ''
    plan.severity_routes.p2 = ''

    expect(validateRollbackIncidentPlan(plan)).toEqual({
      valid: false,
      reasons: [
        'feature_flags',
        'incident_owner',
        'incident_channels',
        'severity_routes.p0',
        'severity_routes.p1',
        'severity_routes.p2',
      ],
    })
  })

  test('rejects plans that do not cover high-risk training incidents', () => {
    const plan = validPlan()
    plan.covers.secret_leak = false
    plan.covers.benchmark_leak = false
    plan.covers.reward_hacking = false
    plan.covers.data_corruption = false
    plan.covers.regression_spike = false

    expect(validateRollbackIncidentPlan(plan)).toEqual({
      valid: false,
      reasons: [
        'covers.secret_leak',
        'covers.benchmark_leak',
        'covers.reward_hacking',
        'covers.data_corruption',
        'covers.regression_spike',
      ],
    })
  })
})
