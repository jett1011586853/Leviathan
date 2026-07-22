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
import {
  getGameSessionSummary,
  stopGameSession,
} from '../../game/runtimeManager.js'
import type { GameModelMode } from '../../game/types.js'

const USAGE_MESSAGE = 'Usage: /gamemodel [observe|demo|live|off|status]'

function parseMode(args: string): GameModelMode | 'status' | undefined {
  const value = args.trim().toLowerCase()
  if (!value) return undefined
  if (['on', 'observe', 'observation'].includes(value)) return 'observe'
  if (['demo', 'demonstration', 'record'].includes(value)) return 'demo'
  if (['live', 'control'].includes(value)) return 'live'
  if (['off', 'close', 'disable'].includes(value)) return 'off'
  if (value === 'status') return 'status'
  return undefined
}

async function switchMode(
  mode: GameModelMode,
  setAppState: (updater: (previous: AppState) => AppState) => void,
): Promise<string> {
  const active = await getGameSessionSummary().catch(() => undefined)
  if (active && active.status !== 'stopped') {
    await stopGameSession().catch(() => undefined)
  }
  setAppState(previous =>
    previous.gameModelMode === mode
      ? previous
      : { ...previous, gameModelMode: mode },
  )
  if (mode === 'off') {
    return 'GameModel disabled. Any active realtime session was stopped and all input state was released.'
  }
  if (mode === 'observe') {
    return 'GameModel observation mode enabled. Realtime state and replay tools are available; keyboard and mouse output remain disabled.'
  }
  if (mode === 'demo') {
    return 'GameModel human demonstration mode enabled. Start a session to record foreground-locked Raw Input, synchronized video, and training actions; Leviathan will not run its policy or emit input.'
  }
  return 'GameModel live mode enabled. Live input is still foreground-locked, lease-bound, and requires a target game window when a session starts.'
}

async function statusMessage(mode: GameModelMode): Promise<string> {
  const summary = await getGameSessionSummary().catch(() => undefined)
  if (!summary) return `GameModel mode: ${mode}. No active realtime session.`
  return [
    `GameModel mode: ${mode}`,
    `Session: ${summary.sessionId}`,
    `Status: ${summary.status}`,
    `Objective: ${summary.objective}`,
    `Observations: ${summary.observationCount}`,
    `Trusted observations: ${summary.perception.trustedObservationCount}`,
    `Rejected observations: ${summary.perception.rejectedObservationCount}`,
    `Perception adapter: ${summary.perception.adapterId ?? summary.perception.status}`,
    `Capture backend: ${summary.perception.captureBackend ?? 'none'}`,
    `Perception capabilities: ${summary.perception.capabilities.join(', ') || 'none'}`,
    `Capture FPS: ${summary.perception.measuredFps?.toFixed(1) ?? 'unknown'} / ${summary.perception.targetFps ?? 'unknown'} target`,
    `Native frames: ${summary.perception.nativeFrameCount ?? 0} (${summary.perception.droppedFrameCount ?? 0} dropped before ingestion)`,
    `Dataset samples: ${summary.perception.sampledFrameCount ?? 0} at ${summary.perception.sampleDirectory ?? 'off'}`,
    `Black frames: ${summary.perception.blackFrameCount ?? 0}`,
    `Recording: ${summary.perception.recordingPath ?? 'off'}`,
    ...(summary.perception.detectorId
      ? [
          `Detector: ${summary.perception.detectorId}`,
          `Detector samples: ${summary.perception.detectorAnalyzedFrameCount ?? 0} (${summary.perception.detectorErrorCount ?? 0} errors)`,
          `Detector inference: ${summary.perception.detectorLastInferenceMs?.toFixed(1) ?? 'unknown'} ms`,
          `Detector evidence: combat ${summary.perception.detectorLastPhaseConfidence?.toFixed(3) ?? 'n/a'}, objective candidate ${summary.perception.detectorLastObjectiveCandidateConfidence?.toFixed(3) ?? 'n/a'} at ${summary.perception.detectorLastObjectiveCandidateAngleDeg?.toFixed(1) ?? 'n/a'} deg, threats ${summary.perception.detectorLastThreatCount ?? 0}`,
        ]
      : []),
    `Decisions: ${summary.decisionCount}`,
    `Intent: ${summary.currentIntent?.kind ?? 'none'}`,
    ...(summary.demonstration
      ? [
          `Demo recorder: ${summary.demonstration.status} (${summary.demonstration.backend} at ${summary.demonstration.sampleHz} Hz)`,
          `Demo episode: ${summary.demonstration.episodeId}`,
          `Human samples: ${summary.demonstration.rawSampleCount} raw / ${summary.demonstration.alignedActionCount} frame-aligned`,
          `Unaligned startup samples: ${summary.demonstration.skippedUnalignedSampleCount}`,
          `Target focused: ${summary.demonstration.targetFocused ?? 'unknown'} (${summary.demonstration.focusLossCount} focus losses)`,
          `Human actions: ${summary.demonstration.actionsPath}`,
        ]
      : []),
    `Session artifacts: ${summary.sessionDir}`,
  ].join('\n')
}

function GameModelDialog({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const currentMode = useAppState(
    (state: AppState) => state.gameModelMode,
  ) as GameModelMode
  const setAppState = useSetAppState()

  const applyMode = (mode: GameModelMode) => {
    void switchMode(mode, setAppState).then(
      message => onDone(message, { display: 'system' }),
      error =>
        onDone(
          `GameModel mode change failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { display: 'system' },
        ),
    )
  }

  return (
    <Dialog
      title="GameModel"
      subtitle={`Current mode: ${currentMode}`}
      color="permission"
      onCancel={() =>
        onDone('GameModel settings unchanged.', { display: 'system' })
      }
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          GameModel separates the slow agent loop from continuous game
          perception and input control. Use demonstration mode to collect
          synchronized human gameplay before training or enabling live input.
        </Text>
        <Select
          defaultValue="observe"
          defaultFocusValue="observe"
          options={[
            {
              label: 'Observation only',
              value: 'observe' as const,
              description: 'Run perception, state, decision, and replay paths without emitting input.',
            },
            {
              label: 'Human demonstration',
              value: 'demo' as const,
              description: 'Record foreground-only Raw Input and synchronized training frames without policy execution.',
            },
            {
              label: 'Live control',
              value: 'live' as const,
              description: 'Allow foreground-locked, lease-bound game input after the session starts.',
            },
            {
              label: 'Off',
              value: 'off' as const,
              description: 'Stop the sidecar and hide GameModel tools.',
            },
          ]}
          onChange={applyMode}
          onCancel={() =>
            onDone('GameModel settings unchanged.', { display: 'system' })
          }
          visibleOptionCount={4}
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
  const raw = (args ?? '').trim()
  if (!raw) return <GameModelDialog onDone={onDone} />
  const parsed = parseMode(raw)
  if (!parsed) {
    onDone(USAGE_MESSAGE, { display: 'system' })
    return null
  }
  if (parsed === 'status') {
    const currentMode = context.getAppState().gameModelMode
    onDone(await statusMessage(currentMode), { display: 'system' })
    return null
  }
  const message = await switchMode(parsed, context.setAppState)
  onDone(message, { display: 'system' })
  return null
}
