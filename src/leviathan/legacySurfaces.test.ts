import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

describe('Leviathan identity surfaces', () => {
  test('system prompts identify Leviathan rather than the recovered product', () => {
    const system = source('constants/system.ts')
    const prompts = source('constants/prompts.ts')
    const coordinator = source('coordinator/coordinatorMode.ts')
    const cli = source('entrypoints/cli.tsx')

    expect(system).toContain('Leviathan')
    expect(system).not.toContain("Anthropic's official CLI for Claude")
    expect(prompts).not.toContain('You are donk')
    expect(coordinator).not.toContain('You are donk')
    expect(cli).toContain('(Leviathan)')
  })

  test('built-in agents and IDE onboarding expose Leviathan identity', () => {
    const generalAgent = source('tools/AgentTool/built-in/generalPurposeAgent.ts')
    const exploreAgent = source('tools/AgentTool/built-in/exploreAgent.ts')
    const planAgent = source('tools/AgentTool/built-in/planAgent.ts')
    const guideAgent = source('tools/AgentTool/built-in/leviathanGuideAgent.ts')
    const statuslineAgent = source('tools/AgentTool/built-in/statuslineSetup.ts')
    const ideOnboarding = source('components/IdeOnboardingDialog.tsx')

    expect(generalAgent).not.toContain('agent for donk')
    expect(exploreAgent).not.toContain('specialist for donk')
    expect(planAgent).not.toContain('planning specialist for donk')
    expect(planAgent).not.toContain('Read CLAUDE.md')
    expect(guideAgent).not.toContain('You are the Claude guide agent')
    expect(guideAgent).not.toContain('donk')
    expect(guideAgent).not.toContain('code.claude.com/docs')
    expect(guideAgent).not.toContain('CLAUDE.md, .claude/ directory')
    expect(guideAgent).not.toContain('Claude API')
    expect(guideAgent).toContain('Anthropic-compatible API')
    expect(statuslineAgent).not.toContain('status line setup agent for donk')
    expect(statuslineAgent).not.toContain("user's donk settings")
    expect(statuslineAgent).not.toContain('~/.claude/settings.json')
    expect(statuslineAgent).not.toContain('~/.claude directory')
    expect(statuslineAgent).not.toContain('Claude.ai subscription')
    expect(statuslineAgent).toContain('Leviathan')
    expect(statuslineAgent).toContain('~/.leviathan/settings.json')
    expect(ideOnboarding).not.toContain('Welcome to donk')
  })
})

describe('Leviathan account-only surfaces', () => {
  test('legacy OAuth component is reduced to a local unavailable notice', () => {
    const oauth = source('components/ConsoleOAuthFlow.tsx')

    expect(oauth).toContain('LEGACY_ACCOUNT_FEATURE_NOTICE')
    expect(oauth).not.toContain('validateForceLoginOrg')
    expect(oauth).not.toContain('startOAuth')
  })

  test('teleport and token helpers cannot mount account OAuth', () => {
    const teleport = source('components/TeleportError.tsx')
    const setupToken = source('cli/handlers/util.tsx')

    expect(teleport).not.toContain('ConsoleOAuthFlow')
    expect(setupToken).not.toContain('ConsoleOAuthFlow')
  })

  test('account subscription upgrade screens do not open Claude services', () => {
    const upgrade = source('commands/upgrade/upgrade.tsx')
    const extraUsage = source('commands/extra-usage/extra-usage.tsx')

    expect(upgrade).not.toContain('claude.ai/upgrade')
    expect(upgrade).not.toContain('Login')
    expect(extraUsage).not.toContain('Login')
  })

  test('print execution does not launch product account OAuth', () => {
    const print = source('cli/print.ts')

    expect(print).not.toContain('.startOAuthFlow(')
  })
})
