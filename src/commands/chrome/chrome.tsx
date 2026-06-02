import type React from 'react'
import { Text } from '../../ink.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'

export const call = async function (
  onDone: (result?: string) => void,
): Promise<React.ReactNode> {
  onDone(LEGACY_ACCOUNT_FEATURE_NOTICE)
  return (
    <Text>
      Legacy browser account integration is unavailable in Leviathan.
    </Text>
  )
}
