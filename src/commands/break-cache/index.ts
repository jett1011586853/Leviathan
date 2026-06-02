import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const breakCache = {
  type: 'local-jsx',
  name: 'break-cache',
  description: 'Break completion cache for debugging',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Completion caches cleared.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default breakCache
