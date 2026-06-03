import type { Command } from '../../commands.js'

const learning = {
  type: 'local-jsx',
  name: 'learning',
  aliases: ['train'],
  description: 'Start or audit Leviathan HL + Polar harness learning',
  argumentHint: 'init|collect|start --config <launch.json> --out <manifest.json>',
  load: () => import('./learning.js'),
} satisfies Command

export default learning
