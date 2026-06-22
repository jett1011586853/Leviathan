import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
}

describe('Leviathan public distribution', () => {
  test('builds a standalone Windows executable with bytecode', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      scripts?: Record<string, string>
    }
    const releaseBuild = packageJson.scripts?.['build:release'] ?? ''

    expect(releaseBuild).toContain('--compile')
    expect(releaseBuild).toContain('--bytecode')
    expect(releaseBuild).toContain('--target=bun-windows-x64')
    expect(releaseBuild).toContain('dist-release/leviathan.exe')
  })

  test('one-line installer verifies release checksums and installs a PATH shim', () => {
    const installer = source('install.ps1')

    expect(installer).toContain('releases/latest')
    expect(installer).toContain('Get-FileHash')
    expect(installer).toContain('SHA256SUMS')
    expect(installer).toContain('leviathan.cmd')
    expect(installer).toContain("SetEnvironmentVariable('Path'")
    expect(installer).not.toContain('ANTHROPIC_AUTH_TOKEN')
  })

  test('launcher applies verified pending updates and checks in the background', () => {
    const launcher = source('scripts/leviathan-launcher.ps1')

    expect(launcher).toContain('Apply-PendingUpdate')
    expect(launcher).toContain('leviathan.previous.exe')
    expect(launcher).toContain('-WindowStyle Hidden')
    expect(launcher).toContain('LEVIATHAN_DISABLE_AUTO_UPDATE')
    expect(launcher).toContain("@('update', 'upgrade')")
  })

  test('updater stages only checksum-verified stable release assets', () => {
    const updater = source('scripts/leviathan-updater.ps1')

    expect(updater).toContain('Get-FileHash')
    expect(updater).toContain('pending-update.json')
    expect(updater).toContain('[version]$latestVersionText')
    expect(updater).toContain('Local\\LeviathanUpdater')
  })

  test('tag workflow verifies, compiles, hashes, and publishes the release', () => {
    const workflow = source('.github/workflows/release.yml')

    expect(workflow).toContain("tags:\n      - 'v*'")
    expect(workflow).toContain('bun run test')
    expect(workflow).toContain('bun run build:release')
    expect(workflow).toContain('Get-FileHash')
    expect(workflow).toContain('gh release create')
  })
})
