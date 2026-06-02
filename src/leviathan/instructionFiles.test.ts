import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
  )[0]!
}

describe('Leviathan instruction files', () => {
  test('new instruction storage and discovery prefer Leviathan paths with legacy read support', () => {
    const config = source('utils/config.ts')
    const memory = source('utils/leviathanmd.ts')

    expect(config).toContain("'LEVIATHAN.md'")
    expect(config).toContain("'LEVIATHAN.local.md'")
    expect(memory).toContain("join(dir, 'LEVIATHAN.md')")
    expect(memory).toContain("join(dir, '.leviathan', 'LEVIATHAN.md')")
    expect(memory).toContain("join(dir, '.leviathan', 'rules')")
    expect(memory).toContain("join(dir, 'CLAUDE.md')")
    expect(memory.indexOf("join(dir, 'LEVIATHAN.md')")).toBeLessThan(
      memory.indexOf("join(dir, 'CLAUDE.md')"),
    )
    expect(memory.indexOf("join(dir, '.leviathan', 'rules')")).toBeLessThan(
      memory.indexOf("join(dir, '.claude', 'rules')"),
    )
    expect(memory).toContain(
      'LEVIATHAN_CODE_ADDITIONAL_DIRECTORIES_LEVIATHAN_MD',
    )
    expect(memory).not.toContain(
      'LEVIATHAN_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD',
    )
  })

  test('/init and onboarding present Leviathan instruction files only', () => {
    const init = source('commands/init.ts')
    const onboarding = source('projectOnboardingState.ts')

    expect(init).toContain('LEVIATHAN.md')
    expect(init).not.toContain('CLAUDE.md')
    expect(init).not.toContain('donk')
    expect(init).not.toContain('Claude')
    expect(onboarding).toContain('LEVIATHAN.md')
    expect(onboarding).toContain('Leviathan')
    expect(onboarding).not.toContain('CLAUDE.md')
    expect(onboarding).not.toContain('Claude')
  })

  test('session context composes Leviathan instruction content', () => {
    const context = source('context.ts')
    const memory = source('utils/leviathanmd.ts')

    expect(context).toContain('getLeviathanMds')
    expect(context).toContain('LEVIATHAN_CODE_DISABLE_LEVIATHAN_MDS')
    expect(context).not.toContain('LEVIATHAN_CODE_DISABLE_CLAUDE_MDS')
    expect(memory).toContain('getLeviathanMds')
  })

  test('instruction safety and diagnostic UI presents Leviathan filenames', () => {
    const dialog = source('components/LeviathanMdExternalIncludesDialog.tsx')
    const settings = source('components/Settings/Config.tsx')
    const doctor = source('utils/doctorContextWarnings.ts')

    expect(dialog).toContain('LEVIATHAN.md')
    expect(dialog).not.toContain("project's CLAUDE.md")
    expect(dialog).not.toContain('external CLAUDE.md file imports')
    expect(settings).toContain('External LEVIATHAN.md includes')
    expect(settings).not.toContain('External CLAUDE.md includes')
    expect(doctor).toContain('Large LEVIATHAN.md')
    expect(doctor).not.toContain('Large CLAUDE.md')
  })

  test('new instruction files trigger write tracking and classifier context', () => {
    const write = source('tools/FileWriteTool/FileWriteTool.ts')
    const edit = source('tools/FileEditTool/FileEditTool.ts')
    const classifier = source('utils/permissions/yoloClassifier.ts')

    expect(write).toContain('LEVIATHAN.md')
    expect(edit).toContain('LEVIATHAN.md')
    expect(classifier).toContain('LEVIATHAN.md')
    expect(classifier).toContain('<user_leviathan_md>')
    expect(classifier).not.toContain('<user_claude_md>')
  })

  test('memory helpers and skill prompts present Leviathan instruction paths', () => {
    const sessionMemory = source('services/SessionMemory/prompts.ts')
    const magicDocs = source('services/MagicDocs/prompts.ts')
    const remember = source('skills/bundled/remember.ts')
    const hooks = source('utils/hooks/hooksConfigManager.ts')
    const selector = source('components/memory/MemoryFileSelector.tsx')

    expect(sessionMemory).toContain('getLeviathanConfigHomeDir')
    expect(sessionMemory).toContain('LEVIATHAN.md')
    expect(sessionMemory).not.toContain('the CLAUDE.md files')
    expect(magicDocs).toContain('getLeviathanConfigHomeDir')
    expect(magicDocs).toContain('LEVIATHAN.md')
    expect(remember).toContain('LEVIATHAN.md')
    expect(remember).toContain('LEVIATHAN.local.md')
    expect(remember).not.toContain('CLAUDE.md')
    expect(hooks).toContain('LEVIATHAN.md')
    expect(hooks).toContain('Leviathan')
    expect(hooks).not.toContain('stdout shown to Claude')
    expect(selector).toContain('LEVIATHAN.md')
    expect(selector).toContain('~/.leviathan/LEVIATHAN.md')
    expect(selector).not.toContain('CLAUDE.md')
    expect(selector).not.toContain('~/.claude')
  })

  test('settings storage writes Leviathan paths while reading legacy settings for migration', () => {
    const settings = source('utils/settings/settings.ts')
    const changeDetector = source('utils/settings/changeDetector.ts')
    const envUtils = source('utils/envUtils.ts')
    const env = source('utils/env.ts')
    const config = source('utils/config.ts')

    expect(settings).toContain('getLeviathanConfigHomeDir')
    expect(settings).toContain('getLegacyClaudeConfigHomeDir')
    expect(settings).toContain("join('.leviathan', 'settings.json')")
    expect(settings).toContain("join('.leviathan', 'settings.local.json')")
    expect(settings).toContain('getLegacySettingsFilePathForSource')
    expect(settings).toContain('getSettingsFilePathsForSource')
    expect(settings).toContain('getLegacyRelativeSettingsFilePathForSource')
    expect(settings).toContain("join('.claude', 'settings.json')")
    expect(settings).toContain("join('.claude', 'settings.local.json')")
    expect(changeDetector).toContain('getSettingsFilePathsForSource')
    expect(envUtils).toContain('export const getClaudeConfigHomeDir = getLeviathanConfigHomeDir')
    expect(envUtils).toContain('getLegacyClaudeConfigHomeDir')
    expect(env).toContain('`.leviathan${fileSuffixForOauthConfig()}.json`')
    expect(env).not.toContain('`.claude${fileSuffixForOauthConfig()}.json`')
    expect(config).toContain('getLegacyClaudeConfigHomeDir')
  })

  test('durable cron storage writes Leviathan paths while reading legacy schedules', () => {
    const tasks = source('utils/cronTasks.ts')
    const scheduler = source('utils/cronScheduler.ts')
    const prompt = source('tools/ScheduleCronTool/prompt.ts')
    const createTool = source('tools/ScheduleCronTool/CronCreateTool.ts')

    expect(tasks).toContain("join('.leviathan', 'scheduled_tasks.json')")
    expect(tasks).toContain('getLegacyCronFilePath')
    expect(tasks).toContain('getCronFilePaths')
    expect(tasks).toContain("join('.claude', 'scheduled_tasks.json')")
    expect(prompt).toContain('.leviathan/scheduled_tasks.json')
    expect(createTool).toContain('.leviathan/scheduled_tasks.json')
    for (const oldPhrase of [
      '.claude/scheduled_tasks.json',
      'Claude session',
      'Claude exits',
      'while Claude was not running',
    ]) {
      expect(prompt).not.toContain(oldPhrase)
      expect(createTool).not.toContain(oldPhrase)
      expect(scheduler).not.toContain(oldPhrase)
    }
  })
})
