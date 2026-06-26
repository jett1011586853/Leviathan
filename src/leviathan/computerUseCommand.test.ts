import { describe, expect, test } from 'bun:test'
import { call } from '../commands/computer/computer.js'
import type { LocalJSXCommandContext } from '../types/command.js'
import { getDefaultAppState, type AppState } from '../state/AppStateStore.js'

function createCommandContext() {
  let appState: AppState = getDefaultAppState()
  const messages: string[] = []
  const context = {
    setAppState(updater: (prev: AppState) => AppState) {
      appState = updater(appState)
    },
  } as LocalJSXCommandContext

  return {
    context,
    messages,
    getAppState: () => appState,
    onDone(message?: string) {
      if (message) messages.push(message)
    },
  }
}

describe('/computer use command', () => {
  test('defaults the feature gate to disabled', () => {
    expect(getDefaultAppState().computerUseEnabled).toBe(false)
  })

  test('can enable and disable ComputerUse and BrowserDevTools directly', async () => {
    const harness = createCommandContext()

    await call(harness.onDone, harness.context, 'use on')
    expect(harness.getAppState().computerUseEnabled).toBe(true)
    expect(harness.messages.at(-1)).toContain('enabled')

    await call(harness.onDone, harness.context, 'use off')
    expect(harness.getAppState().computerUseEnabled).toBe(false)
    expect(harness.messages.at(-1)).toContain('disabled')
  })

  test('rejects unsupported subcommands without changing state', async () => {
    const harness = createCommandContext()

    await call(harness.onDone, harness.context, 'status')
    expect(harness.getAppState().computerUseEnabled).toBe(false)
    expect(harness.messages.at(-1)).toContain('/computer use')
  })
})
