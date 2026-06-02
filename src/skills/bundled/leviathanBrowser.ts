import { registerBundledSkill } from '../bundledSkills.js'

const BROWSER_AUTOMATION_DISABLED =
  'Leviathan browser automation is unavailable until a Leviathan browser extension source is configured.'

export function registerLeviathanBrowserSkill(): void {
  registerBundledSkill({
    name: 'leviathan-browser',
    description: BROWSER_AUTOMATION_DISABLED,
    whenToUse:
      'Do not use this skill. Prefer configured browser automation tools such as WebBrowser or Playwright when available.',
    allowedTools: [],
    userInvocable: false,
    isEnabled: () => false,
    async getPromptForCommand() {
      return [{ type: 'text', text: BROWSER_AUTOMATION_DISABLED }]
    },
  })
}
