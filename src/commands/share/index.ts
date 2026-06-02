import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const share = {
  type: 'local-jsx',
  name: 'share',
  description: 'Share the current conversation',
  isHidden: false,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Generating share link...', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default share
