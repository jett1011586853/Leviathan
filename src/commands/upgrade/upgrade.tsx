import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  onDone(LEGACY_ACCOUNT_FEATURE_NOTICE, { display: 'system' })
  return null
}
