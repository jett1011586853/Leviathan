import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

describe('Leviathan startup integration hard cut', () => {
  test('startup does not load account-backed Chrome or cloud MCP services', () => {
    const main = source('main.tsx')

    expect(main).not.toContain('setupLeviathanBrowser')
    expect(main).not.toContain('shouldEnableLeviathanBrowser')
    expect(main).not.toContain('shouldAutoEnableLeviathanBrowser')
    expect(main).not.toContain('fetchClaudeAIMcpConfigsIfEligible')
    expect(main).not.toContain('Enable Claude in Chrome integration')
    expect(main).not.toContain('enableLeviathanBrowser')
  })

  test('command discovery never evaluates product account eligibility', () => {
    const commands = source('commands.ts')

    expect(commands).not.toContain('isClaudeAISubscriber')
    expect(commands).not.toContain('isUsing3PServices')
    expect(commands).not.toContain('isFirstPartyAnthropicBaseUrl')
    expect(commands).not.toContain('...(bridge ? [bridge] : [])')
    expect(commands).not.toContain('...(remoteControlServerCommand ? [remoteControlServerCommand] : [])')
    expect(commands).not.toContain('\n  passes,\n')
  })

  test('default command registry excludes account-backed interactive features', () => {
    const commands = source('commands.ts')

    expect(commands).not.toContain('...(webCmd ? [webCmd] : [])')
    expect(commands).not.toContain('...(assistantCommand ? [assistantCommand] : [])')
    expect(commands).not.toContain('...(voiceCommand ? [voiceCommand] : [])')
  })

  test('default registry omits recovered product apps and account billing commands', () => {
    const commands = source('commands.ts')

    for (const imported of [
      "import desktop from './commands/desktop/index.js'",
      "import installGitHubApp from './commands/install-github-app/index.js'",
      "import installSlackApp from './commands/install-slack-app/index.js'",
      "import mobile from './commands/mobile/index.js'",
      "import { ultrareview } from './commands/review.js'",
      "import session from './commands/session/index.js'",
      "import teleport from './commands/teleport/index.js'",
      "import usage from './commands/usage/index.js'",
      "import remoteEnv from './commands/remote-env/index.js'",
      "import chrome from './commands/chrome/index.js'",
      "import stickers from './commands/stickers/index.js'",
      "from './commands/extra-usage/index.js'",
      "import rateLimitOptions from './commands/rate-limit-options/index.js'",
      "require('./commands/ultraplan.js')",
      "import oauthRefresh from './commands/oauth-refresh/index.js'",
      "import feedback from './commands/feedback/index.js'",
    ]) {
      expect(commands).not.toContain(imported)
    }
    expect(commands).toContain("import review from './commands/review.js'")
  })

  test('local cost and browser command metadata cannot query subscriptions', () => {
    const costIndex = source('commands/cost/index.ts')
    const cost = source('commands/cost/cost.ts')
    const chromeIndex = source('commands/chrome/index.ts')

    expect(costIndex).not.toContain('isClaudeAISubscriber')
    expect(cost).not.toContain('isClaudeAISubscriber')
    expect(chromeIndex).not.toContain("availability: ['claude-ai']")
    expect(chromeIndex).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
  })
})
