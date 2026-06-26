import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  buildDeepLink,
  DEEP_LINK_PROTOCOL,
  parseDeepLink,
} from '../utils/deepLink/parseDeepLink.js'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

describe('Leviathan hard-cut entry points', () => {
  test('onboarding never mounts product account OAuth', () => {
    const onboarding = source('components/Onboarding.tsx')

    expect(onboarding).not.toContain('ConsoleOAuthFlow')
    expect(onboarding).not.toContain('isAnthropicAuthEnabled')
  })

  test('login commands do not start account OAuth', () => {
    const inSessionLogin = source('commands/login/login.tsx')
    const cliAuth = source('cli/handlers/auth.ts')

    expect(inSessionLogin).not.toContain('ConsoleOAuthFlow')
    expect(inSessionLogin).toContain('ACCOUNT_LOGIN_STATUS')
    expect(cliAuth).not.toContain('startOAuthFlow')
    expect(cliAuth).toContain('ACCOUNT_LOGIN_STATUS')
  })

  test('startup does not validate an account organization', () => {
    const main = source('main.tsx')

    expect(main).not.toContain('validateForceLoginOrg()')
    expect(main).not.toContain('Sign in to your Anthropic account')
    expect(main).not.toContain('requires Claude subscription')
  })

  test('welcome and compact mascot visibly identify Leviathan', () => {
    const welcome = source('components/LogoV2/WelcomeV2.tsx')
    const mascot = source('components/LogoV2/LeviathanMascot.tsx')
    const animatedMascot = source('components/LogoV2/AnimatedLeviathanMascot.tsx')
    const whale = source('components/LogoV2/LeviathanWhale.tsx')
    const logo = source('components/LogoV2/LogoV2.tsx')

    expect(welcome).toContain('LeviathanWhale')
    expect(welcome).toContain('PRODUCT_NAME')
    expect(welcome).toContain('color="leviathan"')
    expect(welcome).not.toContain('Welcome to donk')
    expect(mascot).toContain('LeviathanWhale')
    expect(mascot).toContain('LeviathanMascot')
    expect(animatedMascot).toContain('AnimatedLeviathanMascot')
    expect(whale).toContain('LEVIATHAN_PIXEL_WHALE')
    expect(whale).toContain('color="leviathan"')
    expect(logo).toContain('color("leviathan", userTheme)("Leviathan")')
    expect(logo).not.toContain('color("claude", userTheme)("Leviathan")')
    expect(mascot).not.toContain('donk')
    expect(mascot).not.toContain('Clawd')
    expect(animatedMascot).not.toContain('Clawd')
  })

  test('startup status UI uses Leviathan whale branding instead of recovered glyphs', () => {
    const branding = source('leviathan/branding.ts')
    const figures = source('constants/figures.ts')
    const spinnerUtils = source('components/Spinner/utils.ts')
    const spinnerGlyph = source('components/Spinner/SpinnerGlyph.tsx')
    const spinnerVerbs = source('constants/spinnerVerbs.ts')
    const opusNotice = source('components/LogoV2/Opus1mMergeNotice.tsx')
    const feedConfigs = source('components/LogoV2/feedConfigs.tsx')

    expect(branding).toContain('LEVIATHAN_INLINE_WHALE_FRAMES')
    expect(branding).toContain('LEVIATHAN_STATUS_MARK')
    expect(branding).toContain(
      "LEVIATHAN_STATUS_MARK = '\\u25d6\\u2588\\u2588\\u2588>'",
    )
    expect(branding).toContain('LEVIATHAN_INLINE_WHALE_WIDTH = 6')
    expect(branding).not.toContain("LEVIATHAN_STATUS_MARK = '<\\u2588>'")
    expect(figures).toContain('TEARDROP_ASTERISK = LEVIATHAN_STATUS_MARK')
    expect(spinnerUtils).toContain('LEVIATHAN_INLINE_WHALE_FRAMES')
    expect(spinnerGlyph).toContain('LEVIATHAN_INLINE_WHALE_WIDTH')
    expect(feedConfigs).toContain('LEVIATHAN_STATUS_MARK')
    expect(spinnerVerbs).not.toContain('Clauding')
    expect(opusNotice).toContain('return false')
    expect(opusNotice).not.toContain('Opus now defaults')

    for (const recoveredGlyph of ['✻', '✽', '✶', '✳', '✢']) {
      expect(`${spinnerUtils}\n${spinnerGlyph}\n${feedConfigs}`).not.toContain(
        recoveredGlyph,
      )
    }
  })

  test('deep link entry point uses the Leviathan protocol', () => {
    expect(DEEP_LINK_PROTOCOL).toBe('leviathan-cli')
    expect(buildDeepLink({ query: 'hello' })).toStartWith(
      'leviathan-cli://open',
    )
    expect(parseDeepLink('leviathan-cli://open?q=hello')).toEqual({
      query: 'hello',
      cwd: undefined,
      repo: undefined,
    })
    expect(() => parseDeepLink('claude-cli://open?q=hello')).toThrow(
      'leviathan-cli://',
    )
  })

  test('deep link OS registration exposes Leviathan labels', () => {
    const deepLinkRegistration = [
      source('utils/deepLink/parseDeepLink.ts'),
      source('utils/deepLink/protocolHandler.ts'),
      source('utils/deepLink/registerProtocol.ts'),
      source('utils/deepLink/terminalLauncher.ts'),
    ].join('\n')

    for (const removed of [
      'claude-cli://',
      'claude --handle-uri',
      'com.anthropic.claude-code-url-handler',
      'donk URL Handler',
      'claude-code-url-handler.desktop',
      'donk Deep Link',
      'deep links for donk',
      'launches donk',
      'Launch donk',
    ]) {
      expect(deepLinkRegistration).not.toContain(removed)
    }
    expect(deepLinkRegistration).toContain('leviathan-cli://')
    expect(deepLinkRegistration).toContain('Leviathan URL Handler')
  })
})
