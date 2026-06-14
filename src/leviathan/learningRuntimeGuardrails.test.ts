import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

describe('Leviathan HL runtime guardrails', () => {
  test('default system prompt includes pre-activation harness guardrails for held-out failure slices', async () => {
    const prompt = source('constants/prompts.ts')

    expect(prompt).toContain('# Leviathan Harness Guardrails')
    expect(prompt).toContain(
      'Validate tool names and required arguments before each tool call',
    )
    expect(prompt).toContain(
      'Run the smallest relevant verification command after code changes',
    )
    expect(prompt).toContain(
      'Treat resumed, compacted, and remembered context as stale until verified',
    )
    expect(prompt).toContain(
      'Do not export, persist, or print secrets, private code, or held-out benchmark content',
    )
    expect(prompt).toContain(
      'After tool or shell failures, inspect stderr, exit code, cwd, and exact input before retrying',
    )
  })
})
