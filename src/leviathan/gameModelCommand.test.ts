import { describe, expect, test } from 'bun:test'
import gameModel from '../commands/gamemodel/index.js'
import { call } from '../commands/gamemodel/gamemodel.js'
import {
  getDefaultAppState,
  type AppState,
} from '../state/AppStateStore.js'
import type { LocalJSXCommandContext } from '../types/command.js'

function createHarness() {
  let appState: AppState = getDefaultAppState()
  const messages: string[] = []
  const context = {
    getAppState: () => appState,
    setAppState(updater: (previous: AppState) => AppState) {
      appState = updater(appState)
    },
  } as LocalJSXCommandContext
  return {
    context,
    messages,
    getState: () => appState,
    onDone(message?: string) {
      if (message) messages.push(message)
    },
  }
}

describe('/gamemodel command', () => {
  test('registers a session-scoped local command and defaults off', () => {
    expect(gameModel.name).toBe('gamemodel')
    expect(gameModel.type).toBe('local-jsx')
    expect(gameModel.description).toContain('realtime')
    expect(getDefaultAppState().gameModelMode).toBe('off')
  })

  test('enables observation and live modes explicitly', async () => {
    const harness = createHarness()

    await call(harness.onDone, harness.context, 'observe')
    expect(harness.getState().gameModelMode).toBe('observe')
    expect(harness.messages.at(-1)).toContain('observation mode enabled')

    await call(harness.onDone, harness.context, 'live')
    expect(harness.getState().gameModelMode).toBe('live')
    expect(harness.messages.at(-1)).toContain('live mode enabled')

    await call(harness.onDone, harness.context, 'off')
    expect(harness.getState().gameModelMode).toBe('off')
    expect(harness.messages.at(-1)).toContain('all input state was released')
  })

  test('empty invocation renders the guided mode dialog', async () => {
    const harness = createHarness()
    const rendered = await call(harness.onDone, harness.context, '')
    expect(Boolean(rendered)).toBe(true)
    expect((rendered as { type?: { name?: string } })?.type?.name).toBe(
      'GameModelDialog',
    )
  })
})
