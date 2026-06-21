import * as React from 'react'
import { type ReactNode, useEffect } from 'react'
import { Text } from '../../ink.js'
import type { AgentMemoryScope } from '../../tools/AgentTool/agentMemory.js'

type Props = {
  agentType: string
  scope: AgentMemoryScope
  snapshotTimestamp: string
  onComplete: (choice: 'merge' | 'keep' | 'replace') => void
  onCancel: () => void
}

export function SnapshotUpdateDialog({ onCancel }: Props): ReactNode {
  useEffect(() => {
    onCancel()
  }, [onCancel])

  return <Text dimColor>Agent memory snapshot update is unavailable.</Text>
}
