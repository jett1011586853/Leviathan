import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy } from '../envUtils.js'
import { getPlatform } from '../platform.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations).
 *
 * Defaults ON for every Windows install and can be turned off explicitly with
 * LEVIATHAN_CODE_USE_POWERSHELL_TOOL=0.
 *
 * Why the default flipped: the Bash tool needs a POSIX shell, and on Windows
 * `which bash` almost always resolves to C:\WINDOWS\system32\bash.exe, which is
 * only a launcher for the WSL service. That launcher is unusable whenever the
 * registered distro cannot start (missing ext4.vhdx, stopped service, distro
 * removed), and it fails with an unreadable UTF-16 dump on every command - the
 * single largest source of "the tools keep failing" reports on Windows.
 * PowerShell ships with Windows, needs no extra install, and understands
 * native paths.
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  return !isEnvDefinedFalsy(process.env.LEVIATHAN_CODE_USE_POWERSHELL_TOOL)
}
