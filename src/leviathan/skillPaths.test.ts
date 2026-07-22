import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getKeybindingsPath,
  isKeybindingCustomizationEnabled,
} from '../keybindings/loadUserBindings.js'
import { getMemoryBaseDir } from '../memdir/paths.js'
import { registerSkillCreatorSkill } from '../skills/bundled/skillCreator.js'
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

  test('bundled skill creator is available with Leviathan skill roots', () => {
    const creator = source('skills/bundled/skillCreator.ts')
    const index = source('skills/bundled/index.ts')

    expect(typeof registerSkillCreatorSkill).toBe('function')
    expect(index).toContain("import { registerSkillCreatorSkill }")
    expect(index).toContain('registerSkillCreatorSkill()')
    expect(creator).toContain("name: 'skill-creator'")
    expect(creator).toContain("aliases: ['skill-creater']")
    expect(creator).toContain('userInvocable: true')
    expect(creator).not.toContain('process.env.USER_TYPE')
    expect(creator).toContain('.leviathan/skills/<skill-name>/SKILL.md')
    expect(creator).toContain('~/.leviathan/skills/<skill-name>/SKILL.md')
    expect(creator).toContain('SKILL.md')

    for (const legacy of ['Codex', '.codex', 'Claude', '.claude']) {
      expect(creator).not.toContain(legacy)
    }
  })

  test('chatgpt rescue team skill is bundled and user-invocable', () => {
    const skill = source('skills/bundled/chatgptRescueTeam.ts')
    const index = source('skills/bundled/index.ts')

    expect(index).toContain('registerChatGptRescueTeamSkill')
    expect(index).toContain('registerChatGptRescueTeamSkill()')
    expect(skill).toContain("name: 'chatgpt-rescue-team'")
    expect(skill).toContain('userInvocable: true')
    expect(skill).toContain("'BrowserDevTools'")
    expect(skill).toContain('ask_chatgpt')
    expect(skill).toContain('FULL PROBLEM/PAGE INFORMATION')
  })

  test('AI Coding orchestrator is bundled with staged evidence gates', () => {
    const registration = source('skills/bundled/aiCodingOrchestrator.ts')
    const content = source('skills/bundled/aiCodingOrchestratorContent.ts')
    const skill = source('skills/bundled/ai-coding-orchestrator/SKILL.md')
    const playbook = source(
      'skills/bundled/ai-coding-orchestrator/references/orchestration-playbook.md',
    )
    const rescue = source(
      'skills/bundled/ai-coding-orchestrator/references/rescue-and-compliance.md',
    )
    const index = source('skills/bundled/index.ts')
    const all = [registration, content, skill, playbook, rescue, index].join(
      '\n',
    )

    expect(index).toContain('registerAiCodingOrchestratorSkill')
    expect(index).toContain('registerAiCodingOrchestratorSkill()')
    expect(registration).toContain("name: 'ai-coding-orchestrator'")
    expect(registration).toContain("aliases: ['aicoding', 'ai-coding']")
    expect(registration).toContain('userInvocable: true')
    expect(registration).toContain("'BrowserDevTools'")
    expect(registration).toContain('AI_CODING_SKILL_FILES')
    expect(registration).toContain('Leviathan 提问空间')
    expect(registration).toContain(
      'https://chatgpt.com/c/6a604c21-9eac-83ee-986c-7848328ece4f',
    )
    expect(skill).toContain('## Detect No Progress')
    expect(skill).toContain('default: 3')
    expect(playbook).toContain('## L0 - Collect The Problem And Environment')
    expect(playbook).toContain('## L9 - Decide Whether The Result Is Submit-Ready')
    expect(rescue).toContain('Only one new submission')
    expect(rescue).toContain('Never accept or inject exported cookies')

    for (const credentialMarker of [
      ['oai', 'did='].join('-'),
      ['__Secure', 'oai-is='].join('-'),
      ['oai', 'client-auth-info='].join('-'),
      ['p', 'uid='].join(''),
    ]) {
      expect(all).not.toContain(credentialMarker)
    }
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
