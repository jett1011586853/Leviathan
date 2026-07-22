import { describe, expect, test } from 'bun:test'
import { controlPlanToActionSample } from '../game/actionTrajectory.js'
import type { GameControlPlan } from '../game/types.js'

function plan(overrides: Partial<GameControlPlan> = {}): GameControlPlan {
  return {
    intent: {
      kind: 'engage',
      priority: 70,
      reason: 'test',
      createdAt: 1,
    },
    desiredKeys: ['W', 'Shift'],
    tapKeys: ['R', 'Space'],
    mouseDelta: { x: 25, y: -50 },
    fire: true,
    leaseMs: 100,
    ...overrides,
  }
}

describe('GameModel action trajectories', () => {
  test('normalizes a control plan into the shared 12-dimensional schema', () => {
    const sample = controlPlanToActionSample({
      sessionId: 'session-1',
      episodeId: 'episode-1',
      timestampMs: 1_700_000_000_000,
      frameSequence: 42,
      deltaSeconds: 0.05,
      source: 'policy',
      plan: plan(),
      maxMouseDelta: 50,
    })

    expect(sample.timestamp_ns).toBe('1700000000000000000')
    expect(sample.frame_sequence).toBe(42)
    expect(sample.move_forward).toBe(1)
    expect(sample.sprint).toBe(1)
    expect(sample.reload).toBe(1)
    expect(sample.jump).toBe(1)
    expect(sample.fire).toBe(1)
    expect(sample.mouse_dx).toBe(0.5)
    expect(sample.mouse_dy).toBe(-1)
  })

  test('marks observation-only plans as pseudo without changing values', () => {
    const sample = controlPlanToActionSample({
      sessionId: 'session-1',
      episodeId: 'episode-1',
      timestampMs: 1,
      frameSequence: 0,
      deltaSeconds: 4,
      source: 'pseudo',
      plan: plan({ desiredKeys: [], tapKeys: [], fire: false }),
      maxMouseDelta: 50,
    })

    expect(sample.source).toBe('pseudo')
    expect(sample.delta_seconds).toBe(1)
    expect(sample.fire).toBe(0)
  })
})
