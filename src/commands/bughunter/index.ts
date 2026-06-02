import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const bughunter = {
  type: 'local-jsx',
  name: 'bughunter',
  description: 'Hunt for bugs in the codebase',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Bug hunting initiated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default bughunter
