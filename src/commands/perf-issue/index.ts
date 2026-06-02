import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const perfIssue = {
  type: 'local-jsx',
  name: 'perf-issue',
  description: 'Debug and fix a performance issue',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Performance analysis initiated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default perfIssue
