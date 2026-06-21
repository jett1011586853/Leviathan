import { describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../Tool.js'
import type { PermissionMode } from '../types/permissions.js'
import { getNextPermissionMode } from '../utils/permissions/getNextPermissionMode.js'
import {
  permissionModeShortTitle,
  permissionModeTitle,
} from '../utils/permissions/PermissionMode.js'

function createPermissionContext(
  mode: PermissionMode,
  isBypassPermissionsModeAvailable: boolean,
): ToolPermissionContext {
  return {
    mode,
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable,
    isAutoModeAvailable: false,
  }
}

describe('Leviathan interactive permission mode carousel', () => {
  test('cycles through accept edits, plan, full access, and default', () => {
    const available = true

    expect(
      getNextPermissionMode(createPermissionContext('default', available)),
    ).toBe('acceptEdits')
    expect(
      getNextPermissionMode(createPermissionContext('acceptEdits', available)),
    ).toBe('plan')
    expect(
      getNextPermissionMode(createPermissionContext('plan', available)),
    ).toBe('bypassPermissions')
    expect(
      getNextPermissionMode(
        createPermissionContext('bypassPermissions', available),
      ),
    ).toBe('default')
  })

  test('omits full access when policy disables it', () => {
    expect(
      getNextPermissionMode(createPermissionContext('plan', false)),
    ).toBe('default')
  })

  test('presents bypassPermissions as Full Access in the UI', () => {
    expect(permissionModeTitle('bypassPermissions')).toBe('Full Access')
    expect(permissionModeShortTitle('bypassPermissions')).toBe('Full Access')
  })
})
