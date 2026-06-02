import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'

const antTrace = {
  type: 'local-jsx',
  name: 'ant-trace',
  description: 'Trace feature execution for debugging',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('ANT trace activated.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default antTrace
