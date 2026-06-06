import { describe, expect, test } from 'bun:test'
import { BashTool } from '../tools/BashTool/BashTool.js'

describe('Leviathan BashTool syntax validation', () => {
  test('rejects unterminated shell quotes before execution', async () => {
    const result = await BashTool.validateInput({
      command: 'cd "$WORKDIR && git log --oneline -5',
      description: 'Show recent commits',
    })

    expect(result.result).toBe(false)
    if (result.result === false) {
      expect(result.message).toContain('malformed shell syntax')
      expect(result.message).toContain('unbalanced shell quoting')
    }
  })

  test('allows balanced quoted workspace commands', async () => {
    const result = await BashTool.validateInput({
      command: 'cd "$WORKDIR" && git log --oneline -5',
      description: 'Show recent commits',
    })

    expect(result).toEqual({ result: true })
  })
})
