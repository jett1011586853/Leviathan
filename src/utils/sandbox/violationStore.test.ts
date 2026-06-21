import { describe, expect, test } from 'bun:test'

import {
  readSandboxViolations,
  subscribeToSandboxViolations,
  type SandboxViolationStoreLike,
} from './violationStore.js'
import type { SandboxViolationEvent } from './sandbox-adapter.js'

const event = (line: string): SandboxViolationEvent =>
  ({
    timestamp: new Date('2026-06-17T00:00:00Z'),
    command: 'bash',
    line,
  }) as SandboxViolationEvent

describe('sandbox violation store compatibility', () => {
  test('reads violations from stores without subscribe', () => {
    const store: SandboxViolationStoreLike = {
      getViolations: () => [event('blocked env')],
      getTotalCount: () => 1,
    }

    expect(readSandboxViolations(store).map(v => v.line)).toEqual([
      'blocked env',
    ])
  })

  test('falls back to polling when subscribe is missing', () => {
    const store: SandboxViolationStoreLike = {
      getViolations: () => [event('blocked write')],
      getTotalCount: () => 1,
    }
    let calls = 0

    const cleanup = subscribeToSandboxViolations(store, () => {
      calls += 1
    }, 10)

    cleanup()

    expect(calls).toBe(1)
  })
})
