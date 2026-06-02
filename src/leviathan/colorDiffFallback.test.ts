import { describe, expect, test } from 'bun:test'

import {
  expectColorDiff,
  expectColorFile,
  getSyntaxTheme,
} from '../components/StructuredDiff/colorDiff.js'

describe('Leviathan color diff fallback', () => {
  test('source-mode color diff constructors expose render methods', () => {
    const ColorDiff = expectColorDiff()
    const ColorFile = expectColorFile()

    expect(ColorDiff).not.toBeNull()
    expect(ColorFile).not.toBeNull()
    expect(typeof ColorDiff?.prototype.render).toBe('function')
    expect(typeof ColorFile?.prototype.render).toBe('function')
  })

  test('renders a simple patch through the selected color diff implementation', () => {
    const ColorDiff = expectColorDiff()
    if (!ColorDiff) throw new Error('ColorDiff unavailable')

    const lines = new ColorDiff(
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ['-old', '+new'],
      },
      null,
      'example.ts',
      null,
    ).render('dark', 80, false)

    expect(Array.isArray(lines)).toBe(true)
    expect(lines?.length).toBeGreaterThan(0)
  })

  test('source-mode syntax theme lookup still returns a theme', () => {
    expect(getSyntaxTheme('dark')?.theme).toBeTruthy()
  })
})
