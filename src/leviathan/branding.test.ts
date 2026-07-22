import { describe, expect, test } from 'bun:test'
import {
  LEVIATHAN_PIXEL_WHALE,
  PRODUCT_NAME,
} from './branding.js'

describe('Leviathan hard-cut identity', () => {
  test('uses the Leviathan product identity', () => {
    expect(PRODUCT_NAME).toBe('Leviathan')
  })

  test('ships a compact code-rendered pixel whale', () => {
    expect(LEVIATHAN_PIXEL_WHALE.length).toBeGreaterThanOrEqual(4)
    expect(LEVIATHAN_PIXEL_WHALE.join('\n')).toContain('\u2588')
    expect(Math.max(...LEVIATHAN_PIXEL_WHALE.map(line => line.length))).toBeLessThanOrEqual(18)
  })
})
