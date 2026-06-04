import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

describe('Leviathan active learning runtime integration', () => {
  test('main query prompt assembly includes active learning context', () => {
    const queryEngine = source('QueryEngine.ts')

    expect(queryEngine).toContain('getActiveLearningPromptSection')
    expect(queryEngine).toContain('const activeLearningPrompt')
    expect(queryEngine).toContain(
      '...(activeLearningPrompt ? [activeLearningPrompt] : [])',
    )
  })

  test('side-question fallback mirrors active learning context assembly', () => {
    const queryContext = source('utils/queryContext.ts')

    expect(queryContext).toContain('getActiveLearningPromptSection')
    expect(queryContext).toContain('const activeLearningPrompt')
    expect(queryContext).toContain(
      '...(activeLearningPrompt ? [activeLearningPrompt] : [])',
    )
  })
})
