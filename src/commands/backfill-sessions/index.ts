import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const backfillSessions = {
  type: 'local-jsx',
  name: 'backfill-sessions',
  description: 'Backfill historical session data',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Sessions backfilled.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default backfillSessions
