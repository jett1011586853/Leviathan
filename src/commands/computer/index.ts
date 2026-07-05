import type { Command } from '../../commands.js'

const computer = {
  type: 'local-jsx',
  name: 'computer',
  description: 'Toggle Computer Use desktop and VSCode tools',
  argumentHint: 'use',
  load: () => import('./computer.js'),
} satisfies Command

export default computer
