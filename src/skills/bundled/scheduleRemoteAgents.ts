import { registerBundledSkill } from '../bundledSkills.js'

export function registerScheduleRemoteAgentsSkill(): void {
  registerBundledSkill({
    name: 'schedule',
    description:
      'Create, update, list, or run scheduled Leviathan remote agents.',
    whenToUse:
      'When the user wants to schedule a recurring Leviathan remote agent through a configured remote provider.',
    userInvocable: false,
    isEnabled: () => false,
    allowedTools: [],
    async getPromptForCommand() {
      return [
        {
          type: 'text',
          text: 'Scheduled Leviathan remote agents are unavailable until a Leviathan remote provider is configured.',
        },
      ]
    },
  })
}
