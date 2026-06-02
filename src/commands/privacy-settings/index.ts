import type { Command } from '../../commands.js'

const privacySettings = {
  type: 'local-jsx',
  name: 'privacy-settings',
  description: 'Legacy account privacy settings are unavailable in Leviathan',
  isEnabled: () => false,
  load: () => import('./privacy-settings.js'),
} satisfies Command

export default privacySettings
