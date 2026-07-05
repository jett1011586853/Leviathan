import { describe, expect, test } from 'bun:test'
import { call } from '../commands/browser/browser.js'
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

describe('/browser use command', () => {
  test('defaults the feature gate to disabled', () => {
    expect(getDefaultAppState().browserUseEnabled).toBe(false)
  })

  test('can enable and disable BrowserDevTools directly without changing Computer Use', async () => {
    const harness = createCommandContext()

    await call(harness.onDone, harness.context, 'use on')
    expect(harness.getAppState().browserUseEnabled).toBe(true)
    expect(harness.getAppState().computerUseEnabled).toBe(false)
    expect(harness.messages.at(-1)).toContain('enabled')

    await call(harness.onDone, harness.context, 'use off')
    expect(harness.getAppState().browserUseEnabled).toBe(false)
    expect(harness.getAppState().computerUseEnabled).toBe(false)
    expect(harness.messages.at(-1)).toContain('disabled')
  })

  test('rejects unsupported subcommands without changing state', async () => {
    const harness = createCommandContext()

    await call(harness.onDone, harness.context, 'status')
    expect(harness.getAppState().browserUseEnabled).toBe(false)
    expect(harness.messages.at(-1)).toContain('/browser use')
  })
})
