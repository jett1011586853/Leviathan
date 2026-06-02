import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const issue = {
  type: 'local-jsx',
  name: 'issue',
  description: 'File a bug report or feature request',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Issue filing initiated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default issue
