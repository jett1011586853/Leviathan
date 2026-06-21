import * as React from 'react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import {
  getSandboxViolationTotal,
  subscribeToSandboxViolations,
  type SandboxViolationStoreLike,
} from '../../utils/sandbox/violationStore.js'

export function SandboxPromptFooterHint(): ReactNode {
  const [recentViolationCount, setRecentViolationCount] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const detailsShortcut = useShortcutDisplay(
    'app:toggleTranscript',
    'Global',
    'ctrl+o',
  )

  useEffect(() => {
    if (!SandboxManager.isSandboxingEnabled()) return

    const store =
      SandboxManager.getSandboxViolationStore() as unknown as SandboxViolationStoreLike
    let lastCount = getSandboxViolationTotal(store)

    const cleanup = subscribeToSandboxViolations(store, allViolations => {
      const currentCount = getSandboxViolationTotal(store, allViolations)
      const newViolations = currentCount - lastCount
      if (newViolations > 0) {
        setRecentViolationCount(newViolations)
        lastCount = currentCount
        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }
        timerRef.current = setTimeout(setRecentViolationCount, 5000, 0)
      }
    })

    return () => {
      cleanup()
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  if (!SandboxManager.isSandboxingEnabled() || recentViolationCount === 0) {
    return null
  }

  return (
    <Box paddingX={0} paddingY={0}>
      <Text color="inactive" wrap="truncate">
        Sandbox blocked {recentViolationCount}{' '}
        {recentViolationCount === 1 ? 'operation' : 'operations'} -{' '}
        {detailsShortcut} for details - /sandbox to disable
      </Text>
    </Box>
  )
}
