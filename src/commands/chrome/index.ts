import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'
import type { Command } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const command: Command = {
  name: 'chrome',
  description: 'Legacy browser account integration is unavailable in Leviathan',
  isEnabled: () => false,
  isHidden: true,
  type: 'local-jsx',
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone) {
        onDone(LEGACY_ACCOUNT_FEATURE_NOTICE, { display: 'system' })
        return null
      },
    }),
}

export default command
