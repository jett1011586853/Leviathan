import type React from 'react'
import { Text } from '../../ink.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
): Promise<React.ReactNode> {
  onDone(LEGACY_ACCOUNT_FEATURE_NOTICE, { display: 'system' })
  return (
    <Text>
      Legacy GitHub Actions setup is unavailable in Leviathan.
    </Text>
  )
}
