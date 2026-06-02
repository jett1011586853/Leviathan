import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const ctxViz = {
  type: 'local-jsx',
  name: 'ctx-viz',
  description: 'Visualize context window token usage',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Context visualization generated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default ctxViz
