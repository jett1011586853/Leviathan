import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const resetLimits = {
  type: 'local-jsx',
  name: 'reset-limits',
  description: 'Reset usage rate limits',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Rate limits reset.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

const resetLimitsNonInteractive = {
  type: 'local-jsx',
  name: 'reset-limits-noninteractive',
  description: 'Reset usage rate limits (non-interactive)',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Rate limits reset.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default resetLimits
export { resetLimits, resetLimitsNonInteractive }
