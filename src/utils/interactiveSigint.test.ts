import { describe, expect, test } from 'bun:test'
import {
  decideInteractiveSigint,
  INTERACTIVE_SIGINT_CONFIRMATION_WINDOW_MS,
} from './interactiveSigint.js'

describe('decideInteractiveSigint', () => {
  test('ignores the first process-level SIGINT in an interactive session', () => {
    expect(decideInteractiveSigint(true, 10_000, undefined)).toEqual({
      action: 'ignore',
      nextSignalAt: 10_000,
    })
  })

  test('shuts down after a confirming second SIGINT', () => {
    expect(
      decideInteractiveSigint(
        true,
        10_000 + INTERACTIVE_SIGINT_CONFIRMATION_WINDOW_MS,
        10_000,
      ),
    ).toEqual({ action: 'shutdown', nextSignalAt: undefined })
  })

  test('treats a late second SIGINT as a new first signal', () => {
    const now = 10_000 + INTERACTIVE_SIGINT_CONFIRMATION_WINDOW_MS + 1
    expect(decideInteractiveSigint(true, now, 10_000)).toEqual({
      action: 'ignore',
      nextSignalAt: now,
    })
  })

  test('does not delay shutdown for a non-interactive session', () => {
    expect(decideInteractiveSigint(false, 10_000, undefined)).toEqual({
      action: 'shutdown',
      nextSignalAt: undefined,
    })
  })
})
