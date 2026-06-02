import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

describe('Leviathan distribution boundary', () => {
  test('manual update cannot fetch or install recovered distributions', () => {
    const update = source('cli/update.ts')

    expect(update).toContain('LEVIATHAN_DISTRIBUTION_NOTICE')
    for (const legacyUpdatePath of [
      'installLatestNative',
      'installGlobalPackage',
      'installOrUpdateClaudePackage',
      'getLatestVersion',
      'getDoctorDiagnostic',
    ]) {
      expect(update).not.toContain(legacyUpdatePath)
    }
  })

  test('startup and the prompt do not invoke recovered automatic updates', () => {
    const main = source('main.tsx')
    const notifications = source('components/PromptInput/Notifications.tsx')

    expect(main).not.toContain('assertMinVersion')
    expect(main).toContain(
      "description('Updates are unavailable until a Leviathan distribution source is configured')",
    )
    expect(notifications).not.toContain('AutoUpdaterWrapper')
  })
})
