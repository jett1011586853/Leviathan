import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const onboarding = {
  type: 'local-jsx',
  name: 'onboarding',
  description: 'Show the onboarding tutorial',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Onboarding started.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default onboarding
