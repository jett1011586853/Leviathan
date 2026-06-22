import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
}

describe('Leviathan fast startup launcher', () => {
  test('builds a minified single-file startup artifact with external packages', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      scripts?: Record<string, string>
    }
    const command = packageJson.scripts?.['build:startup']

    expect(command).toContain('--packages=external')
    expect(command).toContain('--minify')
    expect(command).not.toContain('--splitting')
    expect(command).toContain('./dist-startup')
  })

  test('checks source freshness in Bun and rebuilds stale artifacts', () => {
    const launcher = source('scripts/start-leviathan.ts')

    expect(launcher).toContain("new Bun.Glob('src/**/*.{ts,tsx,js,jsx,json,txt}')")
    expect(launcher).toContain('artifactMtime >= (await getLatestInputMtime())')
    expect(launcher).toContain("cmd: [process.execPath, 'run', 'build:startup']")
    expect(launcher).toContain('await import(pathToFileURL(entrypoint).href)')
  })

  test('PowerShell wrapper forwards all CLI arguments to the Bun launcher', () => {
    const launcher = source('scripts/start-leviathan.ps1')

    expect(launcher).toContain("start-leviathan.ts")
    expect(launcher).toContain('@LeviathanArgs')
    expect(launcher).not.toContain('Get-ChildItem')
  })

  test('PowerShell command installer updates a marked profile block', () => {
    const installer = source('scripts/install-leviathan-command.ps1')

    expect(installer).toContain('# >>> Leviathan CLI >>>')
    expect(installer).toContain('# <<< Leviathan CLI <<<')
    expect(installer).toContain("Join-Path $PSScriptRoot 'start-leviathan.ps1'")
    expect(installer).toContain('Set-Alias -Name leviathan')
    expect(installer).toContain('[regex]::Replace')
  })
})
