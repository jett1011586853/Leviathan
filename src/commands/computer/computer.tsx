import React from 'react'
import { Box, Text } from '../../ink.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'

type ComputerUseChoice = 'off' | 'on'

const ENABLED_MESSAGE =
  'Computer Use enabled for this session. ComputerUse and BrowserDevTools are now available to Leviathan.'
const DISABLED_MESSAGE =
  'Computer Use disabled for this session. ComputerUse and BrowserDevTools are hidden from Leviathan.'
const UNCHANGED_MESSAGE = 'Computer Use settings unchanged.'
const USAGE_MESSAGE = 'Usage: /computer use [on|off]'

function completionMessage(enabled: boolean): string {
  return enabled ? ENABLED_MESSAGE : DISABLED_MESSAGE
}

function setComputerUseEnabled(
  context: LocalJSXCommandContext,
  enabled: boolean,
): void {
  context.setAppState(prev =>
    prev.computerUseEnabled === enabled
      ? prev
      : {
          ...prev,
          computerUseEnabled: enabled,
        },
  )
}

function parseDirectChoice(args: string): ComputerUseChoice | null | undefined {
  const parts = args.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return undefined

  const [command, choice] = parts
  if (command !== 'use') return null
  if (choice === undefined) return undefined
  if (['on', 'enable', 'enabled', 'open'].includes(choice)) return 'on'
  if (['off', 'disable', 'disabled', 'close'].includes(choice)) return 'off'
  return null
}

function ComputerUseToggleDialog({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const enabled = useAppState((state: AppState) => state.computerUseEnabled)
  const setAppState = useSetAppState()

  const applyChoice = (choice: ComputerUseChoice) => {
    const nextEnabled = choice === 'on'
    setAppState(prev =>
      prev.computerUseEnabled === nextEnabled
        ? prev
        : {
            ...prev,
            computerUseEnabled: nextEnabled,
          },
    )
    onDone(completionMessage(nextEnabled), { display: 'system' })
  }

  const handleCancel = () => {
    onDone(UNCHANGED_MESSAGE, { display: 'system' })
  }

  const options = [
    {
      label: 'Close',
      value: 'off' as const,
      description: 'Hide ComputerUse and BrowserDevTools from Leviathan.',
    },
    {
      label: 'Enable',
      value: 'on' as const,
      description: 'Enable desktop and browser automation tools this session.',
    },
  ]

  return (
    <Dialog
      title="Computer Use"
      subtitle={`Current status: ${enabled ? 'enabled' : 'disabled'}`}
      color="permission"
      onCancel={handleCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          This controls the ComputerUse and BrowserDevTools tool family.
          Keep it disabled for normal coding sessions, and enable it only
          when you want Leviathan to operate desktop apps or browser pages.
        </Text>
        <Select
          defaultValue="off"
          defaultFocusValue="off"
          options={options}
          onChange={applyChoice}
          onCancel={handleCancel}
          visibleOptionCount={2}
        />
      </Box>
    </Dialog>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode | null> {
  const choice = parseDirectChoice(args ?? '')
  if (choice === null) {
    onDone(USAGE_MESSAGE, { display: 'system' })
    return null
  }

  if (choice !== undefined) {
    const enabled = choice === 'on'
    setComputerUseEnabled(context, enabled)
    onDone(completionMessage(enabled), { display: 'system' })
    return null
  }

  return <ComputerUseToggleDialog onDone={onDone} />
}
