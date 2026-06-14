import { describe, expect, test } from 'bun:test'

import { applyEditToFile } from '../tools/FileEditTool/utils.js'

describe('Leviathan FileEdit replace_all guard', () => {
  test('rejects replace_all with an empty old string in the low-level edit helper', () => {
    expect(() =>
      applyEditToFile('alpha\nbeta\n', '', 'INSERT', true),
    ).toThrow('Cannot use replace_all with an empty old_string')
  })

  test('keeps normal replace_all behavior for non-empty old strings', () => {
    expect(applyEditToFile('alpha\nalpha\n', 'alpha', 'omega', true)).toBe(
      'omega\nomega\n',
    )
  })

  test('rejects edits that would introduce unresolved merge conflict markers', () => {
    expect(() =>
      applyEditToFile(
        'alpha\nomega\n',
        'omega',
        '<<<<<<< HEAD\nomega\n=======\nbeta\n>>>>>>> branch',
      ),
    ).toThrow('Cannot write unresolved merge conflict markers')
  })
})
