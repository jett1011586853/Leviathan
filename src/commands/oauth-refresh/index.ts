import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const oauthRefresh = {
  type: 'local-jsx',
  name: 'oauth-refresh',
  description: 'Force refresh OAuth tokens',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('OAuth tokens refreshed.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default oauthRefresh
