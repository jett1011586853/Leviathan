import type { Command } from '../../types/command.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description: 'Start goal mode and keep working toward a final objective',
  argumentHint: '[objective]',
  load: () => import('./goal.js'),
} satisfies Command

export default goal
