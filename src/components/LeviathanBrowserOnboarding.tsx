import React from 'react'
import { Text } from '../ink.js'

type Props = {
  onDone(): void
}

export function LeviathanBrowserOnboarding({ onDone }: Props): React.ReactNode {
  onDone()
  return (
    <Text>
      Legacy browser account integration is unavailable in Leviathan.
    </Text>
  )
}
