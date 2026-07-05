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

type BrowserUseChoice = 'off' | 'on'

const ENABLED_MESSAGE =
  'Browser Use enabled for this session. BrowserDevTools full Chrome DevTools Protocol actions are now available to Leviathan.'
const DISABLED_MESSAGE =
  'Browser Use disabled for this session. BrowserDevTools actions are hidden from Leviathan.'
const UNCHANGED_MESSAGE = 'Browser Use settings unchanged.'
const USAGE_MESSAGE = 'Usage: /browser use [on|off]'

function completionMessage(enabled: boolean): string {
  return enabled ? ENABLED_MESSAGE : DISABLED_MESSAGE
}

function setBrowserUseEnabled(
  context: LocalJSXCommandContext,
  enabled: boolean,
): void {
  context.setAppState(prev =>
    prev.browserUseEnabled === enabled
      ? prev
      : {
          ...prev,
          browserUseEnabled: enabled,
        },
  )
}

function parseDirectChoice(args: string): BrowserUseChoice | null | undefined {
  const parts = args.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return undefined

  const [command, choice] = parts
  if (command !== 'use') return null
  if (choice === undefined) return undefined
  if (['on', 'enable', 'enabled', 'open'].includes(choice)) return 'on'
  if (['off', 'disable', 'disabled', 'close'].includes(choice)) return 'off'
  return null
}

function BrowserUseToggleDialog({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const enabled = useAppState((state: AppState) => state.browserUseEnabled)
  const setAppState = useSetAppState()

  const applyChoice = (choice: BrowserUseChoice) => {
    const nextEnabled = choice === 'on'
    setAppState(prev =>
      prev.browserUseEnabled === nextEnabled
        ? prev
        : {
            ...prev,
            browserUseEnabled: nextEnabled,
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
      description: 'Hide BrowserDevTools CDP actions from Leviathan.',
    },
    {
      label: 'Enable',
      value: 'on' as const,
      description: 'Enable full Chrome DevTools Protocol browser control this session.',
    },
  ]

  return (
    <Dialog
      title="Browser Use"
      subtitle={`Current status: ${enabled ? 'enabled' : 'disabled'}`}
      color="permission"
      onCancel={handleCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          This controls BrowserDevTools only. When enabled, Leviathan can use
          Chrome DevTools Protocol to inspect and control connected Chromium
          browsers, including sensitive browser internals such as storage,
          network state, targets, downloads, and permissions.
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
    setBrowserUseEnabled(context, enabled)
    onDone(completionMessage(enabled), { display: 'system' })
    return null
  }

  return <BrowserUseToggleDialog onDone={onDone} />
}
