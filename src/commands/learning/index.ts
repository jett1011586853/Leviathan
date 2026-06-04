import type { Command } from '../../commands.js'

const learning = {
  type: 'local-jsx',
  name: 'learning',
  aliases: ['train'],
  description: 'Start or audit Leviathan HL + Polar harness learning',
  argumentHint:
    'init|collect|start|annotate-rollout|train-candidates|train-polar|evaluation-snapshot|promotion-evidence|promote-candidates|promote-polar|run-pipeline --out <file>',
  load: () => import('./learning.js'),
} satisfies Command

export default learning
