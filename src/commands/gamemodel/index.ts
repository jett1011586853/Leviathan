import type { Command } from '../../types/command.js'

const gameModel = {
  type: 'local-jsx',
  name: 'gamemodel',
  description: 'Activate the realtime GameModel agent runtime',
  argumentHint: '[observe|live|off|status]',
  load: () => import('./gamemodel.js'),
} satisfies Command

export default gameModel
