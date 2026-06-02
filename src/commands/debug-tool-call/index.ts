import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const debugToolCall = {
  type: 'local-jsx',
  name: 'debug-tool-call',
  description: 'Debug a specific tool call execution',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Tool call debug mode active.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default debugToolCall
