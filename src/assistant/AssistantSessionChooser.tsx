import * as React from 'react'
import { type ReactNode, useEffect } from 'react'
import { Text } from '../ink.js'
import type { AssistantSession } from './sessionDiscovery.js'

type Props = {
  sessions: AssistantSession[]
  onSelect: (id: string) => void
  onCancel: () => void
}

export function AssistantSessionChooser({
  onCancel,
}: Props): ReactNode {
  useEffect(() => {
    onCancel()
  }, [onCancel])

  return <Text dimColor>Assistant session attachment is unavailable.</Text>
}
