import { join } from 'path'
import type { LocalCommandResult } from '../../commands.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { playAnimation } from '../thinkback/thinkback.js'

const SKILL_NAME = 'thinkback'

export async function call(): Promise<LocalCommandResult> {
  const v2Data = loadInstalledPluginsV2()
  const installations = Object.entries(v2Data.plugins).find(([pluginId]) =>
    pluginId.startsWith(`${SKILL_NAME}@`),
  )?.[1]

  if (!installations || installations.length === 0) {
    return {
      type: 'text' as const,
      value:
        'Install or enable a Leviathan-compatible thinkback plugin with /plugin, then retry.',
    }
  }

  const firstInstall = installations[0]
  if (!firstInstall?.installPath) {
    return {
      type: 'text' as const,
      value: 'Thinkback plugin installation path not found.',
    }
  }

  const skillDir = join(firstInstall.installPath, 'skills', SKILL_NAME)
  const result = await playAnimation(skillDir)
  return { type: 'text' as const, value: result.message }
}
