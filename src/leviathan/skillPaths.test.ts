import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getKeybindingsPath,
  isKeybindingCustomizationEnabled,
} from '../keybindings/loadUserBindings.js'
import { getMemoryBaseDir } from '../memdir/paths.js'
import { getSkillsPath } from '../skills/loadSkillsDir.js'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

describe('Leviathan skill paths', () => {
  test('skill and command roots use Leviathan directories', () => {
    const previous = process.env.LEVIATHAN_CONFIG_DIR
    process.env.LEVIATHAN_CONFIG_DIR = join('D:', 'leviathan-home')
    try {
      expect(getSkillsPath('userSettings', 'skills')).toBe(
        join('D:', 'leviathan-home', 'skills'),
      )
      expect(getSkillsPath('userSettings', 'commands')).toBe(
        join('D:', 'leviathan-home', 'commands'),
      )
      expect(getSkillsPath('projectSettings', 'skills')).toBe(
        '.leviathan/skills',
      )
      expect(getSkillsPath('projectSettings', 'commands')).toBe(
        '.leviathan/commands',
      )
      expect(getKeybindingsPath()).toBe(
        join('D:', 'leviathan-home', 'keybindings.json'),
      )
      expect(isKeybindingCustomizationEnabled()).toBe(true)
      expect(getMemoryBaseDir()).toBe(join('D:', 'leviathan-home'))
    } finally {
      if (previous === undefined) {
        delete process.env.LEVIATHAN_CONFIG_DIR
      } else {
        process.env.LEVIATHAN_CONFIG_DIR = previous
      }
    }
  })

  test('skill change watcher does not watch legacy .claude skill roots', () => {
    const detector = source('utils/skills/skillChangeDetector.ts')

    expect(detector).not.toContain('~/.claude/skills')
    expect(detector).not.toContain('.claude/skills')
    expect(detector).toContain('~/.leviathan/skills')
    expect(detector).toContain("'.leviathan', 'skills'")
  })

  test('skill loader discovers Leviathan skill roots instead of legacy Claude roots', () => {
    const loader = source('skills/loadSkillsDir.ts')

    for (const removed of [
      "getClaudeConfigHomeDir(), 'skills'",
      "getManagedFilePath(), '.claude', 'skills'",
      "join(dir, '.claude', 'skills')",
      "join(currentDir, '.claude', 'skills')",
    ]) {
      expect(loader).not.toContain(removed)
    }

    expect(loader).toContain("getLeviathanConfigHomeDir(), 'skills'")
    expect(loader).toContain("getManagedFilePath(), '.leviathan', 'skills'")
    expect(loader).toContain("join(dir, '.leviathan', 'skills')")
    expect(loader).toContain("join(currentDir, '.leviathan', 'skills')")
  })

  test('skill prompt variables expose Leviathan names', () => {
    const loader = source('skills/loadSkillsDir.ts')

    expect(loader).toContain('LEVIATHAN_SKILL_DIR')
    expect(loader).toContain('LEVIATHAN_SESSION_ID')
  })

  test('markdown config discovery scans Leviathan roots', () => {
    const loader = source('utils/markdownConfigLoader.ts')
    const suggestions = source('hooks/fileSuggestions.ts')

    expect(loader).toContain('LEVIATHAN_CONFIG_DIRECTORIES')
    expect(loader).toContain('LeviathanConfigDirectory')
    expect(suggestions).toContain('LEVIATHAN_CONFIG_DIRECTORIES')
    for (const removed of [
      'CLAUDE_CONFIG_DIRECTORIES',
      'ClaudeConfigDirectory',
      "join(getClaudeConfigHomeDir(), subdir)",
      "join(getManagedFilePath(), '.claude', subdir)",
      "join(current, '.claude', subdir)",
      "join(gitRoot, '.claude', subdir)",
      "join(canonicalRoot, '.claude', subdir)",
    ]) {
      expect(loader + suggestions).not.toContain(removed)
    }
    expect(loader).toContain("join(getLeviathanConfigHomeDir(), subdir)")
    expect(loader).toContain("join(getManagedFilePath(), '.leviathan', subdir)")
    expect(loader).toContain("join(current, '.leviathan', subdir)")
  })
})
