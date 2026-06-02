import React from 'react'
import { Box, Text } from '../ink.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'

type Props = {
  onDone(): void
  startingMessage?: string
  mode?: 'login' | 'setup-token'
  forceLoginMethod?: string
}

export function ConsoleOAuthFlow(_props: Props): React.ReactNode {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text color="warning">{LEGACY_ACCOUNT_FEATURE_NOTICE}</Text>
    </Box>
  )
}
