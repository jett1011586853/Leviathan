import React from 'react'
import type { CodeSession } from 'src/utils/teleport/api.js'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js'
import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'

type Props = {
  onSelect: (session: CodeSession) => void
  onCancel: () => void
  isEmbedded?: boolean
}

export function ResumeTask({
  onSelect: _onSelect,
  onCancel,
  isEmbedded: _isEmbedded = false,
}: Props): React.ReactNode {
  const escKey = useShortcutDisplay('confirm:no', 'Confirmation', 'Esc')
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
  })

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="warning">
        Remote session resume is unavailable
      </Text>
      <Text dimColor>{LEGACY_ACCOUNT_FEATURE_NOTICE}</Text>
      <Text dimColor>
        Press <Text bold>{escKey}</Text> to cancel
      </Text>
    </Box>
  )
}
