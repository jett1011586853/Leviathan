import type { Command } from '../../types/command.js'

const leviathan = {
  type: 'local',
  name: 'leviathan',
  description: 'Create or locate installation-wide Leviathan preferences',
  supportsNonInteractive: false,
  load: () => import('./leviathan.js'),
} satisfies Command

export default leviathan
