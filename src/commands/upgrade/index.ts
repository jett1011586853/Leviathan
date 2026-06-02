import type { Command } from '../../commands.js'

const upgrade = {
  type: 'local-jsx',
  name: 'upgrade',
  description: 'Legacy account upgrades are unavailable in Leviathan local mode',
  isEnabled: () => false,
  isHidden: true,
  load: () => import('./upgrade.js'),
} satisfies Command

export default upgrade
