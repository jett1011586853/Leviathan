import React from 'react'
import { Box, Text } from 'src/ink.js'
import { MessageResponse } from '../MessageResponse.js'

type UpsellParams = {
  shouldShowUpsell: boolean
  isMax20x: boolean
  isExtraUsageCommandEnabled: boolean
  shouldAutoOpenRateLimitOptionsMenu: boolean
  isTeamOrEnterprise: boolean
  hasBillingAccess: boolean
}

export function getUpsellMessage(_params: UpsellParams): string | null {
  return null
}

type RateLimitMessageProps = {
  text: string
  onOpenRateLimitOptions?: () => void
}

export function RateLimitMessage({
  text,
}: RateLimitMessageProps): React.ReactNode {
  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">{text}</Text>
      </Box>
    </MessageResponse>
  )
}
