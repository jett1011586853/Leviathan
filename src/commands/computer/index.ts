import type { Command } from '../../commands.js'

const computer = {
  type: 'local-jsx',
  name: 'computer',
  description: 'Toggle Computer Use and browser DevTools tools',
  argumentHint: 'use',
  load: () => import('./computer.js'),
} satisfies Command

export default computer
