import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const teleport = {
  type: 'local-jsx',
  name: 'teleport',
  description: 'Connect to a remote session',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Teleport session initiated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default teleport
