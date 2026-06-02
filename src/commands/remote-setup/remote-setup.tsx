import type { ReactNode } from 'react'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
): Promise<ReactNode> {
  onDone(LEGACY_ACCOUNT_FEATURE_NOTICE)
  return null
}
