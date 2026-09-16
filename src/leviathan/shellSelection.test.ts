import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { getTools } from '../tools.js'
import { POWERSHELL_TOOL_NAME } from '../tools/PowerShellTool/toolName.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { getPlatform } from '../utils/platform.js'
import { resolveDefaultShell } from '../utils/shell/resolveDefaultShell.js'
import { isPowerShellToolEnabled } from '../utils/shell/shellToolUtils.js'

const onWindows = getPlatform() === 'windows'

describe('shell selection on Windows', () => {
  test('enables the PowerShell tool by default and keeps bash as a fallback', () => {
    if (!onWindows) {
      // The tool is Windows-only; other platforms must stay unaffected.
      expect(isPowerShellToolEnabled()).toBe(false)
      return
    }

    expect(isPowerShellToolEnabled()).toBe(true)

    const toolNames = getTools(getEmptyToolPermissionContext()).map(
      tool => tool.name,
    )
    expect(toolNames).toContain(POWERSHELL_TOOL_NAME)
    expect(toolNames).toContain(BASH_TOOL_NAME)
  })

  test('honors the explicit opt-out', () => {
    process.env.LEVIATHAN_CODE_USE_POWERSHELL_TOOL = '0'
    try {
      expect(isPowerShellToolEnabled()).toBe(false)
      const toolNames = getTools(getEmptyToolPermissionContext()).map(
        tool => tool.name,
      )
      expect(toolNames).not.toContain(POWERSHELL_TOOL_NAME)
      expect(toolNames).toContain(BASH_TOOL_NAME)
      // With the PowerShell tool gone, the shell default falls back to bash.
      expect(resolveDefaultShell()).toBe('bash')
    } finally {
      delete process.env.LEVIATHAN_CODE_USE_POWERSHELL_TOOL
    }
  })

  test('defaults the input-box shell to PowerShell on Windows', () => {
    expect(resolveDefaultShell()).toBe(onWindows ? 'powershell' : 'bash')
  })
})
