import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import type { AppState } from '../state/AppStateStore.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import type { ModelSetting } from '../utils/model/model.js'
import {
  activateModelSlot,
  loadModelSlotState,
  type ModelSlot,
  type ModelSlotId,
  MODEL_SLOT_IDS,
  saveModelSlot,
  validateModelSlotBaseUrl,
  validateModelSlotName,
} from '../utils/model/modelSlots.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import TextInput from './TextInput.js'

type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
}

type ConfigureStep = 'slots' | 'baseUrl' | 'modelName' | 'apiKey'

type Draft = {
  baseUrl: string
  modelName: string
}

export function ModelSlotPicker({
  sessionModel,
  onSelect,
  onCancel = () => {},
  isStandaloneCommand = false,
  showFastModeNotice = false,
}: Props): React.ReactNode {
  const [slotState, setSlotState] = useState(loadModelSlotState)
  const [focusedSlotId, setFocusedSlotId] = useState<ModelSlotId>(
    slotState.activeSlotId ?? 1,
  )
  const [editingSlotId, setEditingSlotId] = useState<ModelSlotId | null>(null)
  const [step, setStep] = useState<ConfigureStep>('slots')
  const [draft, setDraft] = useState<Draft>({ baseUrl: '', modelName: '' })
  const [inputValue, setInputValue] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const setAppState = useSetAppState()
  const effortValue = useAppState(
    (state: AppState) => state.effortValue,
  ) as AppState['effortValue']
  const [effort, setEffort] = useState<EffortLevel>(() =>
    effortValue === undefined
      ? 'high'
      : convertEffortValueToLevel(effortValue),
  )
  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const { columns } = useTerminalSize()
  const inputColumns = Math.max(24, Math.min(columns - 8, 100))

  const slotsById = useMemo(
    () => new Map(slotState.slots.map(slot => [slot.id, slot])),
    [slotState.slots],
  )
  const focusedSlot = slotsById.get(focusedSlotId)
  const focusedSupportsEffort = focusedSlot
    ? modelSupportsEffort(focusedSlot.modelName)
    : false
  const focusedSupportsMax = focusedSlot
    ? modelSupportsMaxEffort(focusedSlot.modelName)
    : false
  const focusedDefaultEffort = focusedSlot
    ? getDefaultEffortLevel(focusedSlot.modelName)
    : 'high'
  const displayEffort =
    effort === 'max' && !focusedSupportsMax ? 'high' : effort

  const options = useMemo(
    () =>
      MODEL_SLOT_IDS.map(id => {
        const slot = slotsById.get(id)
        return {
          value: id,
          label: slot ? `Slot ${id}  ${slot.modelName}` : `Slot ${id}  Empty`,
          description: slot
            ? slot.baseUrl
            : 'Press Enter to configure this slot',
        }
      }),
    [slotsById],
  )

  const beginConfigure = useCallback(
    (id: ModelSlotId) => {
      const existing = slotsById.get(id)
      const baseUrl = existing?.baseUrl ?? ''
      setEditingSlotId(id)
      setDraft({
        baseUrl,
        modelName: existing?.modelName ?? '',
      })
      setInputValue(baseUrl)
      setCursorOffset(baseUrl.length)
      setError(null)
      setStep('baseUrl')
    },
    [slotsById],
  )

  const persistEffort = useCallback(
    (modelName: string): EffortLevel | undefined => {
      const defaultEffort = getDefaultEffortLevel(modelName)
      const selectedEffort =
        effort === 'max' && !modelSupportsMaxEffort(modelName)
          ? 'high'
          : effort
      const effortLevel = resolvePickerEffortPersistence(
        selectedEffort,
        defaultEffort,
        getSettingsForSource('userSettings')?.effortLevel,
        hasToggledEffort,
      )
      const persistable = toPersistableEffort(effortLevel)
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', { effortLevel: persistable })
      }
      setAppState(previous => ({ ...previous, effortValue: effortLevel }))
      return hasToggledEffort && modelSupportsEffort(modelName)
        ? selectedEffort
        : undefined
    },
    [effort, hasToggledEffort, setAppState],
  )

  const selectConfiguredSlot = useCallback(
    (id: ModelSlotId) => {
      try {
        const slot = activateModelSlot(id)
        setSlotState(loadModelSlotState())
        const selectedEffort = persistEffort(slot.modelName)
        onSelect(slot.modelName, selectedEffort)
      } catch {
        setError('Unable to activate this model slot. Reconfigure it and try again.')
      }
    },
    [onSelect, persistEffort],
  )

  const handleSlotSelect = useCallback(
    (id: ModelSlotId) => {
      if (slotsById.has(id)) {
        selectConfiguredSlot(id)
      } else {
        beginConfigure(id)
      }
    },
    [beginConfigure, selectConfiguredSlot, slotsById],
  )

  useInput(
    input => {
      if (input.toLowerCase() === 'e' && slotsById.has(focusedSlotId)) {
        beginConfigure(focusedSlotId)
      }
    },
    { isActive: step === 'slots' },
  )

  const cycleEffort = useCallback(
    (direction: 'left' | 'right') => {
      if (!focusedSupportsEffort) return
      const levels: EffortLevel[] = focusedSupportsMax
        ? ['low', 'medium', 'high', 'max']
        : ['low', 'medium', 'high']
      const current = levels.includes(effort) ? effort : 'high'
      const index = levels.indexOf(current)
      const offset = direction === 'right' ? 1 : -1
      setEffort(levels[(index + offset + levels.length) % levels.length]!)
      setHasToggledEffort(true)
    },
    [effort, focusedSupportsEffort, focusedSupportsMax],
  )

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => cycleEffort('left'),
      'modelPicker:increaseEffort': () => cycleEffort('right'),
    },
    { context: 'ModelPicker', isActive: step === 'slots' },
  )

  const returnToSlots = useCallback(() => {
    setStep('slots')
    setEditingSlotId(null)
    setInputValue('')
    setCursorOffset(0)
    setError(null)
  }, [])

  const handleFieldSubmit = useCallback(
    (value: string) => {
      try {
        if (step === 'baseUrl') {
          const baseUrl = validateModelSlotBaseUrl(value)
          setDraft(previous => ({ ...previous, baseUrl }))
          setInputValue(draft.modelName)
          setCursorOffset(draft.modelName.length)
          setError(null)
          setStep('modelName')
          return
        }
        if (step === 'modelName') {
          const modelName = validateModelSlotName(value)
          setDraft(previous => ({ ...previous, modelName }))
          setInputValue('')
          setCursorOffset(0)
          setError(null)
          setStep('apiKey')
          return
        }
        if (step !== 'apiKey' || editingSlotId === null) return

        saveModelSlot(editingSlotId, {
          baseUrl: draft.baseUrl,
          modelName: draft.modelName,
          apiKey: value.trim() || undefined,
        })
        selectConfiguredSlot(editingSlotId)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to save this model slot.')
      }
    },
    [draft, editingSlotId, selectConfiguredSlot, step],
  )

  const picker = (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold>
          Model slots
        </Text>
        <Text dimColor>
          Save up to five Anthropic-compatible provider profiles. Slots may use
          the same model name.
        </Text>
        {sessionModel && (
          <Text dimColor>Session override: {String(sessionModel)}</Text>
        )}
      </Box>

      {step === 'slots' ? (
        <>
          <Select
            options={options}
            defaultValue={slotState.activeSlotId ?? undefined}
            defaultFocusValue={focusedSlotId}
            onFocus={(id: ModelSlotId) => {
              setFocusedSlotId(id)
              setError(null)
              if (!hasToggledEffort && effortValue === undefined) {
                const slot = slotsById.get(id)
                if (slot) setEffort(getDefaultEffortLevel(slot.modelName))
              }
            }}
            onChange={handleSlotSelect}
            onCancel={onCancel}
            visibleOptionCount={5}
          />
          <Box marginTop={1} flexDirection="column">
            {focusedSupportsEffort ? (
              <Text dimColor>
                {capitalize(displayEffort)} effort{' '}
                <Text color="subtle">← → to adjust</Text>
              </Text>
            ) : (
              <Text color="subtle">
                {focusedSlot
                  ? `Effort is not supported for ${focusedSlot.modelName}`
                  : 'Configure this slot to select a model'}
              </Text>
            )}
            {error && <Text color="error">{error}</Text>}
            {showFastModeNotice && (
              <Text dimColor>Changing slots may turn Fast mode off.</Text>
            )}
          </Box>
          <Text dimColor italic>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="switch/configure" />
              <KeyboardShortcutHint shortcut="E" action="edit slot" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          </Text>
        </>
      ) : (
        <Box flexDirection="column">
          <Text bold>
            Configure slot {editingSlotId} · Step {stepNumber(step)} of 3
          </Text>
          <Text dimColor>{stepPrompt(step, slotsById.get(editingSlotId!))}</Text>
          <Box marginTop={1}>
            <TextInput
              value={inputValue}
              onChange={value => {
                setInputValue(value)
                setError(null)
              }}
              onSubmit={handleFieldSubmit}
              onExit={returnToSlots}
              placeholder={stepPlaceholder(step)}
              mask={step === 'apiKey' ? '*' : undefined}
              columns={inputColumns}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
              focus
              showCursor
              multiline={false}
            />
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color="error">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor italic>
              Enter to continue · Esc to return to slots
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  )

  return isStandaloneCommand ? <Pane color="permission">{picker}</Pane> : picker
}

function getDefaultEffortLevel(modelName: string): EffortLevel {
  const value = getDefaultEffortForModel(modelName)
  return value === undefined ? 'high' : convertEffortValueToLevel(value)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function stepNumber(step: ConfigureStep): number {
  if (step === 'baseUrl') return 1
  if (step === 'modelName') return 2
  return 3
}

function stepPrompt(step: ConfigureStep, existing?: ModelSlot): string {
  if (step === 'baseUrl') {
    return 'Enter the provider base URL. Example: https://gateway.example/anthropic'
  }
  if (step === 'modelName') {
    return 'Enter the exact model ID accepted by this provider.'
  }
  return existing
    ? 'Enter a new API key, or leave blank to keep the saved key. Input is hidden.'
    : 'Enter the API key or auth token. Input is hidden and stored locally.'
}

function stepPlaceholder(step: ConfigureStep): string {
  if (step === 'baseUrl') return 'https://gateway.example/anthropic'
  if (step === 'modelName') return 'model-name'
  return 'API key / auth token'
}
