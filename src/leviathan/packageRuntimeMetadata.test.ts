import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function packageJson(): {
  packageManager?: string
  engines?: Record<string, string>
  scripts?: Record<string, string>
} {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
}

describe('Leviathan package runtime metadata', () => {
  test('pins Bun as the package manager and exposes the canonical test command', () => {
    const pkg = packageJson()

    expect(pkg.packageManager).toMatch(/^bun@/)
    expect(pkg.engines?.bun).toBeDefined()
    expect(pkg.scripts?.test).toBe('bun test src/leviathan --timeout 30000')
  })
})
