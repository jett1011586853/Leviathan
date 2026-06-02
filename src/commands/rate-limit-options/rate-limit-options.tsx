import type React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
): Promise<React.ReactNode> {
  onDone(LEGACY_ACCOUNT_FEATURE_NOTICE, { display: 'system' })
  return null
}
