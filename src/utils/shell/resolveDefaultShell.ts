import { getPlatform } from '../platform.js'
import { getInitialSettings } from '../settings/settings.js'
import { isPowerShellToolEnabled } from './shellToolUtils.js'

/**
 * Resolve the default shell for input-box `!` commands.
 *
 * Resolution order (docs/design/ps-shell-selection.md §4.2):
 *   settings.defaultShell → 'bash'
 *
 * Platform default is 'bash' everywhere — we do NOT auto-flip Windows to
 * PowerShell (would break existing Windows users with bash hooks).
 */
export function resolveDefaultShell(): 'bash' | 'powershell' {
  const configured = getInitialSettings().defaultShell
  if (configured) return configured
  // Windows defaults to PowerShell: it is installed everywhere, understands
  // native paths, and needs no POSIX shell (WSL launcher or Git Bash) that may
  // be missing or broken. settings.defaultShell still wins when set.
  if (getPlatform() === 'windows' && isPowerShellToolEnabled()) {
    return 'powershell'
  }
  return 'bash'
}
