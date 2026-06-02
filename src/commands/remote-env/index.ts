import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'remote-env',
  description: 'Remote environments are unavailable in Leviathan local mode',
  isEnabled: () => false,
  get isHidden() {
    return true
  },
  load: () => import('./remote-env.js'),
} satisfies Command
