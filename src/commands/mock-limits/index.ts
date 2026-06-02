import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const mockLimits = {
  type: 'local-jsx',
  name: 'mock-limits',
  description: 'Mock rate limits for testing',
  isHidden: true,
  isEnabled: () => false,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        onDone('Rate limits now being mocked.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default mockLimits
