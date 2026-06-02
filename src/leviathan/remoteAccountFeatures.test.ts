import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

describe('Leviathan account-backed remote features', () => {
  test('bootstrap fast paths do not launch browser or bridge account services', () => {
    const cli = source('entrypoints/cli.tsx')

    expect(cli).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(cli).not.toContain('runLeviathanBrowserMcpServer')
    expect(cli).not.toContain('runChromeNativeHost')
    expect(cli).not.toContain('bridgeMain')
    expect(cli).not.toContain('getClaudeAIOAuthTokens')
    expect(cli).not.toContain('BRIDGE_LOGIN_ERROR')
  })

  test('interactive remote flags are rejected before remote session calls', () => {
    const main = source('main.tsx')
    const rejection = main.indexOf(
      'teleport !== null || remote !== null || remoteControlOption !== undefined',
    )
    const remoteCall = main.indexOf('teleportToRemoteWithErrorHandling')

    expect(rejection).toBeGreaterThan(0)
    expect(rejection).toBeLessThan(remoteCall)
    expect(main).not.toContain('getRemoteControlAtStartup()')
    expect(main).not.toContain('getBridgeDisabledReason')
    expect(main).not.toContain('isCcrMirrorEnabled')
  })

  test('print teleport cannot resume an account-backed remote session', () => {
    const print = source('cli/print.ts')

    expect(print).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(print).not.toContain('teleportResumeCodeSession')
  })

  test('startup and bundled skills never load recovered managed integrations', () => {
    const main = source('main.tsx')
    const registry = source('services/mcp/officialRegistry.ts')
    const bundled = source('skills/bundled/index.ts')

    expect(main).not.toContain('prefetchOfficialMcpUrls')
    expect(registry).not.toContain('api.anthropic.com/mcp-registry')
    expect(registry).not.toContain('axios')
    for (const removedSkill of [
      'shouldAutoEnableLeviathanBrowser',
      'registerLeviathanBrowserSkill',
      'scheduleRemoteAgents',
      'registerClaudeApiSkill',
    ]) {
      expect(bundled).not.toContain(removedSkill)
    }
    expect(bundled).toContain('registerProviderApiSkill')
  })

  test('local tool registry cannot expose remote account trigger tools', () => {
    const tools = source('tools.ts')

    expect(tools).not.toContain('RemoteTriggerTool')
    expect(tools).not.toContain('AGENT_TRIGGERS_REMOTE')
  })
})
