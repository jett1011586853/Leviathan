import { getSecureStorage } from '../secureStorage/index.js'

export const MODEL_SLOT_IDS = [1, 2, 3, 4, 5] as const
export type ModelSlotId = (typeof MODEL_SLOT_IDS)[number]

export type ModelSlot = {
  id: ModelSlotId
  baseUrl: string
  modelName: string
}

export type ModelSlotState = {
  activeSlotId: ModelSlotId | null
  slots: ModelSlot[]
}

export type ModelSlotInput = {
  baseUrl: string
  modelName: string
  apiKey?: string
}

type SecureStorageData = {
  pluginSecrets?: Record<string, Record<string, string> | undefined>
  [key: string]: unknown
}

export type ModelSlotStorage = {
  read(): SecureStorageData | null
  update(data: SecureStorageData): { success: boolean; warning?: string }
}

type Environment = Record<string, string | undefined>

const STORAGE_NAMESPACE = 'leviathan:model-slots'
const ACTIVE_SLOT_KEY = 'activeSlot'

function getStorage(): ModelSlotStorage {
  return getSecureStorage() as unknown as ModelSlotStorage
}

function slotKey(id: ModelSlotId, field: 'baseUrl' | 'modelName' | 'apiKey') {
  return `slot${id}.${field}`
}

function isModelSlotId(value: number): value is ModelSlotId {
  return MODEL_SLOT_IDS.includes(value as ModelSlotId)
}

export function validateModelSlotBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) {
    throw new Error('Enter a valid base URL.')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Base URL must be a complete http:// or https:// URL.')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Base URL must use http:// or https://.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Do not include credentials in the base URL.')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Base URL cannot contain a query string or fragment.')
  }

  return trimmed.replace(/\/+$/, '')
}

export function validateModelSlotName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 512 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('Enter a valid model name.')
  }
  return trimmed
}

export function validateModelSlotApiKey(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 8192 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('Enter a valid API key or auth token.')
  }
  return trimmed
}

function readNamespace(storage: ModelSlotStorage): Record<string, string> {
  try {
    return storage.read()?.pluginSecrets?.[STORAGE_NAMESPACE] ?? {}
  } catch {
    return {}
  }
}

function readConfiguredSlot(
  id: ModelSlotId,
  values: Record<string, string>,
): (ModelSlot & { apiKey: string }) | null {
  try {
    return {
      id,
      baseUrl: validateModelSlotBaseUrl(values[slotKey(id, 'baseUrl')] ?? ''),
      modelName: validateModelSlotName(values[slotKey(id, 'modelName')] ?? ''),
      apiKey: validateModelSlotApiKey(values[slotKey(id, 'apiKey')] ?? ''),
    }
  } catch {
    return null
  }
}

function writeNamespace(
  storage: ModelSlotStorage,
  values: Record<string, string>,
): void {
  const existing = storage.read() ?? {}
  const result = storage.update({
    ...existing,
    pluginSecrets: {
      ...existing.pluginSecrets,
      [STORAGE_NAMESPACE]: values,
    },
  })
  if (!result.success) {
    throw new Error('Unable to save the model slot securely.')
  }
}

export function loadModelSlotState(
  storage: ModelSlotStorage = getStorage(),
): ModelSlotState {
  const values = readNamespace(storage)
  const slots = MODEL_SLOT_IDS.flatMap(id => {
    const slot = readConfiguredSlot(id, values)
    return slot ? [{ id, baseUrl: slot.baseUrl, modelName: slot.modelName }] : []
  })
  const activeValue = Number(values[ACTIVE_SLOT_KEY])
  const activeSlotId =
    isModelSlotId(activeValue) && slots.some(slot => slot.id === activeValue)
      ? activeValue
      : null

  return { activeSlotId, slots }
}

export function saveModelSlot(
  id: ModelSlotId,
  input: ModelSlotInput,
  storage: ModelSlotStorage = getStorage(),
): ModelSlot {
  const values = readNamespace(storage)
  const existingApiKey = values[slotKey(id, 'apiKey')]
  const apiKey = input.apiKey?.trim()
    ? validateModelSlotApiKey(input.apiKey)
    : validateModelSlotApiKey(existingApiKey ?? '')
  const slot = {
    id,
    baseUrl: validateModelSlotBaseUrl(input.baseUrl),
    modelName: validateModelSlotName(input.modelName),
  }

  writeNamespace(storage, {
    ...values,
    [slotKey(id, 'baseUrl')]: slot.baseUrl,
    [slotKey(id, 'modelName')]: slot.modelName,
    [slotKey(id, 'apiKey')]: apiKey,
  })
  return slot
}

function applySlotToEnvironment(
  slot: ModelSlot & { apiKey: string },
  env: Environment,
): void {
  env.ANTHROPIC_BASE_URL = slot.baseUrl
  env.ANTHROPIC_MODEL = slot.modelName
  env.ANTHROPIC_AUTH_TOKEN = slot.apiKey
  delete env.ANTHROPIC_API_KEY
  delete env.LEVIATHAN_CODE_USE_BEDROCK
  delete env.LEVIATHAN_CODE_USE_VERTEX
  delete env.LEVIATHAN_CODE_USE_FOUNDRY
}

export function activateModelSlot(
  id: ModelSlotId,
  storage: ModelSlotStorage = getStorage(),
  env: Environment = process.env,
): ModelSlot {
  const values = readNamespace(storage)
  const slot = readConfiguredSlot(id, values)
  if (!slot) {
    throw new Error(`Model slot ${id} is not configured.`)
  }

  writeNamespace(storage, { ...values, [ACTIVE_SLOT_KEY]: String(id) })
  applySlotToEnvironment(slot, env)
  return { id: slot.id, baseUrl: slot.baseUrl, modelName: slot.modelName }
}

export function applySavedModelSlot(
  storage: ModelSlotStorage = getStorage(),
  env: Environment = process.env,
): ModelSlot | null {
  const values = readNamespace(storage)
  const activeValue = Number(values[ACTIVE_SLOT_KEY])
  if (!isModelSlotId(activeValue)) {
    return null
  }
  const slot = readConfiguredSlot(activeValue, values)
  if (!slot) {
    return null
  }
  applySlotToEnvironment(slot, env)
  return { id: slot.id, baseUrl: slot.baseUrl, modelName: slot.modelName }
}
