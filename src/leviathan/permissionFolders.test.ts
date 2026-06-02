import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setOriginalCwd } from '../bootstrap/state.js'
import {
  getFilePermissionOptions,
  isInGlobalLeviathanFolder,
  isInLeviathanFolder,
} from '../components/permissions/FilePermissionDialog/permissionOptions.js'
import { PERMISSION_HANDLERS } from '../components/permissions/FilePermissionDialog/usePermissionHandler.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import {
  FILE_EDIT_TOOL_NAME,
  GLOBAL_LEVIATHAN_FOLDER_PERMISSION_PATTERN,
  LEVIATHAN_FOLDER_PERMISSION_PATTERN,
} from '../tools/FileEditTool/constants.js'
import {
  checkWritePermissionForTool,
  DANGEROUS_DIRECTORIES,
  DANGEROUS_FILES,
  getLeviathanSkillScope,
} from '../utils/permissions/filesystem.js'
import type { PermissionUpdate } from '../utils/permissions/PermissionUpdateSchema.js'

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8').split(
    '//# sourceMappingURL=',
    1,
  )[0]
}

function withTempProject<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-permissions-'))
  try {
    setOriginalCwd(dir)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Leviathan permission folders', () => {
  test('offers session-scoped edits for project .leviathan files', () => {
    withTempProject(dir => {
      const leviathanSettings = join(dir, '.leviathan', 'settings.json')
      const legacySettings = join(dir, '.claude', 'settings.json')
      const options = getFilePermissionOptions({
        filePath: leviathanSettings,
        toolPermissionContext: getEmptyToolPermissionContext(),
      })

      expect(isInLeviathanFolder(leviathanSettings)).toBe(true)
      expect(isInLeviathanFolder(legacySettings)).toBe(false)
      expect(options.find(option => option.value === 'yes-leviathan-folder'))
        .toMatchObject({
          option: {
            type: 'accept-session',
            scope: 'leviathan-folder',
          },
        })
      expect(options.some(option => option.value === 'yes-claude-folder')).toBe(
        false,
      )
    })
  })

  test('session scope writes Leviathan folder permission patterns', () => {
    let suggestions: PermissionUpdate[] | undefined
    let done = 0

    PERMISSION_HANDLERS['accept-session'](
      {
        messageId: 'message',
        path: null,
        toolUseConfirm: {
          input: {},
          tool: { name: FILE_EDIT_TOOL_NAME },
          onAllow(_input: unknown, updates: PermissionUpdate[]) {
            suggestions = updates
          },
          onReject() {},
        } as never,
        toolPermissionContext: getEmptyToolPermissionContext(),
        onDone() {
          done += 1
        },
        onReject() {},
        completionType: 'write_file_single',
        languageName: 'typescript',
        operationType: 'write',
      },
      { scope: 'leviathan-folder' } as never,
    )

    expect(done).toBe(1)
    expect(suggestions).toEqual([
      {
        type: 'addRules',
        rules: [
          {
            toolName: FILE_EDIT_TOOL_NAME,
            ruleContent: LEVIATHAN_FOLDER_PERMISSION_PATTERN,
          },
        ],
        behavior: 'allow',
        destination: 'session',
      },
    ])
  })

  test('detects global Leviathan config without matching the legacy global folder', () => {
    const globalLeviathanSettings = join(homedir(), '.leviathan', 'settings.json')
    const globalLegacySettings = join(homedir(), '.claude', 'settings.json')

    expect(isInGlobalLeviathanFolder(globalLeviathanSettings)).toBe(true)
    expect(isInGlobalLeviathanFolder(globalLegacySettings)).toBe(false)
    expect(GLOBAL_LEVIATHAN_FOLDER_PERMISSION_PATTERN).toBe('~/.leviathan/**')
  })

  test('write permission prompts name Leviathan for protected Leviathan config files', () => {
    withTempProject(dir => {
      const filePath = join(dir, '.leviathan', 'settings.json')
      const decision = checkWritePermissionForTool(
        {
          name: FILE_EDIT_TOOL_NAME,
          getPath() {
            return filePath
          },
        } as never,
        {},
        getEmptyToolPermissionContext(),
      )

      expect(decision.behavior).toBe('ask')
      expect(decision.message).toContain('Leviathan requested permissions')
      expect(decision.message).not.toContain('Claude requested permissions')
    })
  })

  test('permission safety rules protect Leviathan config and bypass only with Leviathan patterns', () => {
    const filesystem = source('utils/permissions/filesystem.ts')

    expect(DANGEROUS_DIRECTORIES).toContain('.leviathan')
    expect(DANGEROUS_FILES).toContain('.leviathan.json')
    expect(filesystem).toContain('LEVIATHAN_FOLDER_PERMISSION_PATTERN')
    expect(filesystem).toContain('GLOBAL_LEVIATHAN_FOLDER_PERMISSION_PATTERN')
    expect(filesystem).toContain("join(getOriginalCwd(), '.leviathan', 'commands')")
    expect(filesystem).toContain("join(getOriginalCwd(), '.leviathan', 'agents')")
    expect(filesystem).toContain("join(getOriginalCwd(), '.leviathan', 'skills')")
    expect(filesystem).not.toContain('CLAUDE_FOLDER_PERMISSION_PATTERN')
    expect(filesystem).not.toContain('GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN')
    expect(filesystem).not.toContain("join(getOriginalCwd(), '.claude', 'commands')")
    expect(filesystem).not.toContain("join(getOriginalCwd(), '.claude', 'agents')")
    expect(filesystem).not.toContain("join(getOriginalCwd(), '.claude', 'skills')")
  })

  test('skill-specific edit suggestions scope to .leviathan skills', () => {
    withTempProject(dir => {
      const projectSkill = join(dir, '.leviathan', 'skills', 'reviewer', 'SKILL.md')
      const legacySkill = join(dir, '.claude', 'skills', 'reviewer', 'SKILL.md')

      expect(getLeviathanSkillScope(projectSkill)).toEqual({
        skillName: 'reviewer',
        pattern: '/.leviathan/skills/reviewer/**',
      })
      expect(getLeviathanSkillScope(legacySkill)).toBeNull()
    })
  })
})
