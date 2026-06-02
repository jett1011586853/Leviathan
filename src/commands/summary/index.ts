import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const summary = {
  type: 'local-jsx',
  name: 'summary',
  description: 'Summarize the current conversation',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Summary generation initiated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default summary
