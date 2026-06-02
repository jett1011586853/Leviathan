import type { Command } from '../../commands.js'

function isExtraUsageAllowed(): boolean {
  return false
}

export const extraUsage = {
  type: 'local-jsx',
  name: 'extra-usage',
  description: 'Legacy extra usage is unavailable in Leviathan local mode',
  isEnabled: () => isExtraUsageAllowed(),
  isHidden: true,
  load: () => import('./extra-usage.js'),
} satisfies Command

export const extraUsageNonInteractive = {
  type: 'local',
  name: 'extra-usage',
  supportsNonInteractive: true,
  description: 'Legacy extra usage is unavailable in Leviathan local mode',
  isEnabled: () => isExtraUsageAllowed(),
  get isHidden() {
    return true
  },
  load: () => import('./extra-usage-noninteractive.js'),
} satisfies Command
