import type { Command, LocalJSXCommandOnDone } from '../../types/command.js'

const env = {
  type: 'local-jsx',
  name: 'env',
  description: 'Show environment information',
  isHidden: false,
  isEnabled: () => true,
  load: () =>
    Promise.resolve({
      async call(onDone: LocalJSXCommandOnDone): Promise<null> {
        const vars = Object.entries(process.env)
          .filter(([k]) => !k.includes('SECRET') && !k.includes('TOKEN') && !k.includes('KEY'))
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
        onDone(vars || 'No environment variables set.', { display: 'system' })
        return null
      },
    }),
} satisfies Command

export default env
