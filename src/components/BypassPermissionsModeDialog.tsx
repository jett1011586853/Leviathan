import React, { useEffect } from 'react'
import { logEvent } from 'src/services/analytics/index.js'
import { Box, Newline, Text } from '../ink.js'
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

type Props = {
  onAccept(): void
  onDecline?: () => void
}

export function BypassPermissionsModeDialog({
  onAccept,
  onDecline,
}: Props): React.ReactNode {
  useEffect(() => {
    logEvent('tengu_bypass_permissions_mode_dialog_shown', {})
  }, [])

  const handleDecline = onDecline ?? (() => gracefulShutdownSync(1))
  const options = [
    {
      label: onDecline ? 'No, go back' : 'No, exit',
      value: 'decline' as const,
    },
    {
      label: 'Yes, I accept',
      value: 'accept' as const,
    },
  ]

  const handleChange = (value: 'accept' | 'decline') => {
    if (value === 'decline') {
      handleDecline()
      return
    }

    logEvent('tengu_bypass_permissions_mode_dialog_accept', {})
    updateSettingsForSource('userSettings', {
      skipDangerousModePermissionPrompt: true,
    })
    onAccept()
  }

  return (
    <Dialog
      title="Enable full access mode?"
      color="error"
      onCancel={handleDecline}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          In Full Access mode, Leviathan will not ask for approval before
          running potentially dangerous commands.
          <Newline />
          Use this mode only in an environment you trust and can restore if it
          is damaged.
        </Text>
        <Text>
          By proceeding, you accept responsibility for actions taken in Full
          Access mode.
        </Text>
      </Box>
      <Select options={options} onChange={handleChange} onCancel={handleDecline} />
    </Dialog>
  )
}
