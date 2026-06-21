import { ensureInstallationLeviathanMd } from '../../leviathan/installationInstructions.js'
import type { LocalCommandResult } from '../../types/command.js'
import { clearMemoryFileCaches } from '../../utils/leviathanmd.js'

export async function call(): Promise<LocalCommandResult> {
  const { path, created } = await ensureInstallationLeviathanMd()

  // Ensure later context rebuilds see edits made after this command.
  clearMemoryFileCaches()

  const action = created ? 'Created' : 'Found existing'
  return {
    type: 'text',
    value: `${action} installation-wide preferences file:\n${path}\n\nAdd your lasting habits, workflow preferences, coding rules, and response preferences to this file, then save it. Leviathan automatically loads its contents into context every time it starts, from any workspace. Restart the current session after editing to load the latest changes.`,
  }
}
