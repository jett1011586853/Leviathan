import { beforeEach, describe, expect, test } from 'bun:test'
import {
  activateModelSlot,
  applySavedModelSlot,
  loadModelSlotState,
  type ModelSlotStorage,
  saveModelSlot,
} from '../utils/model/modelSlots.js'

function createStorage(): ModelSlotStorage & { snapshot(): unknown } {
  let data: ReturnType<ModelSlotStorage['read']> = null
  return {
    read: () => structuredClone(data),
    update: next => {
      data = structuredClone(next)
      return { success: true }
    },
    snapshot: () => structuredClone(data),
  }
}

describe('Leviathan model slots', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(() => {
    storage = createStorage()
  })

  test('starts with exactly five available slot positions and no active slot', () => {
    const state = loadModelSlotState(storage)

    expect(state.slots).toEqual([])
    expect(state.activeSlotId).toBeNull()
  })

  test('allows duplicate models in separate slots and switches provider environment', () => {
    saveModelSlot(
      1,
      {
        baseUrl: 'https://gateway-one.example/anthropic',
        modelName: 'mimo-v2.5',
        apiKey: 'token-one',
      },
      storage,
    )
    saveModelSlot(
      2,
      {
        baseUrl: 'https://gateway-two.example/anthropic',
        modelName: 'mimo-v2.5',
        apiKey: 'token-two',
      },
      storage,
    )
    const env: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'old-key',
      LEVIATHAN_CODE_USE_BEDROCK: '1',
    }

    const active = activateModelSlot(2, storage, env)

    expect(active.modelName).toBe('mimo-v2.5')
    expect(loadModelSlotState(storage).slots).toHaveLength(2)
    expect(loadModelSlotState(storage).activeSlotId).toBe(2)
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://gateway-two.example/anthropic',
      ANTHROPIC_MODEL: 'mimo-v2.5',
      ANTHROPIC_AUTH_TOKEN: 'token-two',
    })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.LEVIATHAN_CODE_USE_BEDROCK).toBeUndefined()
  })

  test('keeps the existing secret when editing a configured slot', () => {
    saveModelSlot(
      3,
      {
        baseUrl: 'https://gateway.example/anthropic',
        modelName: 'first-model',
        apiKey: 'keep-this-token',
      },
      storage,
    )
    saveModelSlot(
      3,
      {
        baseUrl: 'https://gateway.example/anthropic',
        modelName: 'second-model',
      },
      storage,
    )
    const env: Record<string, string | undefined> = {}

    activateModelSlot(3, storage, env)

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('keep-this-token')
    expect(env.ANTHROPIC_MODEL).toBe('second-model')
  })

  test('restores the active slot without exposing its API key in public state', () => {
    saveModelSlot(
      5,
      {
        baseUrl: 'https://gateway.example/anthropic',
        modelName: 'model-five',
        apiKey: 'private-token',
      },
      storage,
    )
    activateModelSlot(5, storage, {})
    const env: Record<string, string | undefined> = {}

    const restored = applySavedModelSlot(storage, env)

    expect(restored?.id).toBe(5)
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('private-token')
    expect(JSON.stringify(loadModelSlotState(storage))).not.toContain(
      'private-token',
    )
  })

  test('rejects malformed provider URLs before storing credentials', () => {
    expect(() =>
      saveModelSlot(
        1,
        {
          baseUrl: 'file:///tmp/provider',
          modelName: 'model',
          apiKey: 'token',
        },
        storage,
      ),
    ).toThrow('http:// or https://')
    expect(storage.snapshot()).toBeNull()
  })
})
