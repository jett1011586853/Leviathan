import { describe, expect, test } from 'bun:test'

import { getUnavailableToolUseError } from '../services/tools/toolExecution.js'

describe('Leviathan unavailable tool recovery guidance', () => {
  test('suggests Bash search fallback when Glob is unavailable', () => {
    const message = getUnavailableToolUseError('Glob', ['Bash', 'Read', 'Edit'])

    expect(message).toContain('No such tool available: Glob')
    expect(message).toContain('use Bash with rg, find, or ls')
    expect(message).toContain('Available tools: Bash, Read, Edit')
  })

  test('suggests available file-reading alternatives when Read is unavailable', () => {
    const message = getUnavailableToolUseError('Read', ['REPL', 'Bash'])

    expect(message).toContain('No such tool available: Read')
    expect(message).toContain('use REPL if it is available')
    expect(message).toContain('or Bash with sed, cat, or Get-Content')
  })
})
