import type { CommandResultDisplay } from 'src/commands.js'
import { LEVIATHAN_DISTRIBUTION_NOTICE } from '../leviathan/branding.js'

export const install = {
  type: 'local-jsx' as const,
  name: 'install',
  description: 'Leviathan self-install is unavailable',
  argumentHint: '',
  async call(
    onDone: (
      result: string,
      options?: { display?: CommandResultDisplay },
    ) => void,
    _context: unknown,
    _args: string[],
  ): Promise<void> {
    onDone(LEVIATHAN_DISTRIBUTION_NOTICE, { display: 'system' })
  },
}
