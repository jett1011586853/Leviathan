import { describe, expect, test } from 'bun:test'
import {
  ACCOUNT_LOGIN_REQUIRED,
  ACCOUNT_LOGIN_STATUS,
  LEVIATHAN_PIXEL_WHALE,
  PRODUCT_NAME,
} from './branding.js'

describe('Leviathan hard-cut identity', () => {
  test('does not require product account login', () => {
    expect(PRODUCT_NAME).toBe('Leviathan')
    expect(ACCOUNT_LOGIN_REQUIRED).toBe(false)
    expect(ACCOUNT_LOGIN_STATUS).toContain('does not require account sign-in')
  })

  test('ships a compact code-rendered pixel whale', () => {
    expect(LEVIATHAN_PIXEL_WHALE.length).toBeGreaterThanOrEqual(4)
    expect(LEVIATHAN_PIXEL_WHALE.join('\n')).toContain('\u2588')
    expect(Math.max(...LEVIATHAN_PIXEL_WHALE.map(line => line.length))).toBeLessThanOrEqual(18)
  })
})
