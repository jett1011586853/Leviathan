import {describe, expect, test} from 'bun:test'
import {shouldDeferPaste} from './usePasteHandler.js'

describe('paste submission state', () => {
  test('does not defer a short bracketed paste without an onPaste handler', () => {
    expect(shouldDeferPaste(false, 'mimo-v2.5'.length, false, false, true)).toBe(
      false,
    )
  })

  test('defers bracketed paste when a component handles completed pastes', () => {
    expect(shouldDeferPaste(true, 'mimo-v2.5'.length, false, false, true)).toBe(
      true,
    )
  })

  test('keeps subsequent chunks in an active deferred paste', () => {
    expect(shouldDeferPaste(true, 1, true, false, false)).toBe(true)
  })
})
