import { LEVIATHAN_DISTRIBUTION_NOTICE } from '../leviathan/branding.js'
import { gracefulShutdown } from '../utils/gracefulShutdown.js'

export async function update(): Promise<void> {
  process.stderr.write(`${LEVIATHAN_DISTRIBUTION_NOTICE}\n`)
  await gracefulShutdown(1)
}
