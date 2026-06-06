import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Leviathan sandbox dependency guidance', () => {
  test('does not send users to recovered sandbox-runtime package names', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/sandbox/SandboxDependenciesTab.tsx'),
      'utf8',
    )

    expect(source).not.toContain('@anthropic-ai/sandbox-runtime')
    expect(source).toContain('vendor/seccomp')
  })
})
