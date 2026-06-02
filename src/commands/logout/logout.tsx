import * as React from 'react'
import { Text } from '../../ink.js'
import { ACCOUNT_LOGIN_STATUS } from '../../leviathan/branding.js'
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js'

export async function performLogout(_options: {
  clearOnboarding?: boolean
}): Promise<void> {}

export async function clearAuthRelatedCaches(): Promise<void> {}

export async function call(): Promise<React.ReactNode> {
  const message = <Text>{ACCOUNT_LOGIN_STATUS}</Text>
  setTimeout(() => {
    gracefulShutdownSync(0, 'logout')
  }, 200)
  return message
}
