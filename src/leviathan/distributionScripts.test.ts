import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  )
}

describe('Leviathan public distribution', () => {
  test('declares every optional provider imported by the standalone runtime', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      dependencies?: Record<string, string>
    }
    const dependencies = packageJson.dependencies ?? {}

    for (const packageName of [
      '@anthropic-ai/bedrock-sdk',
      '@anthropic-ai/foundry-sdk',
      '@anthropic-ai/mcpb',
      '@anthropic-ai/vertex-sdk',
      '@aws-sdk/client-bedrock',
      '@aws-sdk/client-bedrock-runtime',
      '@aws-sdk/client-sts',
      '@aws-sdk/credential-provider-node',
      '@azure/identity',
    ]) {
      expect(dependencies[packageName]).toBeString()
    }
  })

  test('builds a standalone Windows executable with bytecode', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      version?: string
      scripts?: Record<string, string>
    }
    const cliEntrypoint = source('src/entrypoints/cli.tsx')
    const releaseBuild = packageJson.scripts?.['build:release'] ?? ''

    expect(cliEntrypoint).toContain(`VERSION: process.env.LEVIATHAN_CODE_VERSION ?? '${packageJson.version}'`)
    expect(releaseBuild).toContain('--compile')
    expect(releaseBuild).toContain('--bytecode')
    expect(releaseBuild).toContain('--target=bun-windows-x64')
    expect(releaseBuild).toContain('--windows-icon=./assets/leviathan-icon.ico')
    expect(releaseBuild).toContain('--windows-title=Leviathan')
    expect(releaseBuild).toContain('--windows-description="Leviathan AI coding agent"')
    expect(releaseBuild).toContain('dist-release/leviathan.exe')
    expect(packageJson.scripts?.['build:game-capture']).toContain(
      'native/game-capture/Cargo.toml',
    )
  })

  test('one-line installer verifies release checksums and installs a PATH shim', () => {
    const installer = source('install.ps1')

    expect(installer).toContain('releases/latest')
    expect(installer).toContain('Get-FileHash')
    expect(installer).toContain('SHA256SUMS')
    expect(installer).toContain('leviathan.cmd')
    expect(installer).toContain('leviathan-game-capture-windows-x64.exe')
    expect(installer).toContain('libvips-42.dll')
    expect(installer).toContain('libvips-cpp-8.17.3.dll')
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
    expect(launcher).toContain('$env:PATH = "$installRoot;$env:PATH"')
  })

  test('updater stages only checksum-verified stable release assets', () => {
    const updater = source('scripts/leviathan-updater.ps1')

    expect(updater).toContain('Get-FileHash')
    expect(updater).toContain('pending-update.json')
    expect(updater).toContain('[version]$latestVersionText')
    expect(updater).toContain('Local\\LeviathanUpdater')
    expect(updater).toContain('leviathan-game-capture-windows-x64.exe')
    expect(updater).toContain('libvips-42.dll')
    expect(updater).toContain('libvips-cpp-8.17.3.dll')
  })

  test('offline package installs verified standalone assets without credentials', () => {
    const installer = source('scripts/leviathan-offline-installer.ps1')
    const builder = source('scripts/build-offline-package.ps1')

    expect(installer).toContain('Get-FileHash')
    expect(installer).toContain('SHA256SUMS')
    expect(installer).toContain('leviathan.cmd')
    expect(installer).toContain("SetEnvironmentVariable('Path'")
    expect(installer).toContain('leviathan.previous.exe')
    expect(installer).toContain('LEVIATHAN_INSTALL_SKIP_PATH')
    expect(installer).toContain('libvips-42.dll')
    expect(installer).toContain('libvips-cpp-8.17.3.dll')
    expect(installer).not.toContain('Invoke-WebRequest')
    expect(installer).not.toContain('Invoke-RestMethod')
    expect(installer).not.toContain('ANTHROPIC_AUTH_TOKEN')
    expect(builder).toContain('bun run build:release')
    expect(builder).toContain('bun run build:game-capture')
    expect(builder).toContain('Packaged Leviathan executable failed its startup smoke test')
    expect(builder).toContain('Compress-Archive')
  })

  test('tag workflow verifies, compiles, hashes, and publishes the release', () => {
    const workflow = source('.github/workflows/release.yml')

    expect(workflow).toContain("tags:\n      - 'v*'")
    expect(workflow).toContain('bun run test')
    expect(workflow).toContain('bun run build:release')
    expect(workflow).toContain('bun run build:game-capture')
    expect(workflow).toContain('leviathan-game-capture-windows-x64.exe')
    expect(workflow).toContain('libvips-42.dll')
    expect(workflow).toContain('libvips-cpp-8.17.3.dll')
    expect(workflow).toContain('Get-FileHash')
    expect(workflow).toContain('gh release create')
  })
})
