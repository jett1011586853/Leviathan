import type { Command } from '../../types/command.js'

const browser = {
  type: 'local-jsx',
  name: 'browser',
  description: 'Toggle Browser Use Chrome DevTools Protocol tools',
  argumentHint: 'use',
  load: () => import('./browser.js'),
} satisfies Command

export default browser
