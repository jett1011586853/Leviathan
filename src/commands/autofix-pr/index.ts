import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const autofixPr = {
  type: 'local-jsx',
  name: 'autofix-pr',
  description: 'Automatically fix issues in a pull request',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('PR auto-fix scanning initiated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default autofixPr
