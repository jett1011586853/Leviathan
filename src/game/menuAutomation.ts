import {
  runWindowsComputerUse,
  type ComputerUseOutput,
  type ComputerUseStep,
  type ComputerUseWindow,
} from '../tools/ComputerUseTool/windowsComputerUse.js'
import type { GameMenuAction, GameProfile } from './types.js'

export type GameMenuFlowResult = {
  flowName: string
  hwnd: string
  actionCount: number
  output: ComputerUseOutput
}

export async function runGameMenuFlow(input: {
  profile: GameProfile
  flowName: string
  hwnd?: string
  signal?: AbortSignal
}): Promise<GameMenuFlowResult> {
  const flowName = normalizeFlowName(input.flowName)
  const actions = input.profile.menuFlows[flowName]
  if (!actions?.length) {
    throw new Error(
      `Game menu flow "${flowName}" is not calibrated. Save normalized coordinates before running it.`,
    )
  }
  const window = await findGameWindow(input.profile, input.hwnd, input.signal)
  const hwnd = window.hwnd
  const state = await runWindowsComputerUse(
    {
      action: 'get_window_state',
      hwnd,
      include_screenshot: true,
      include_text: false,
    },
    input.signal,
  )
  const screenshot = state.state?.screenshots[0]
  if (!screenshot) throw new Error('Could not capture the target game window.')
  const steps = actions.flatMap((action) =>
    toComputerUseSteps(action, screenshot.width, screenshot.height),
  )
  const output = await runWindowsComputerUse(
    {
      action: 'sequence',
      hwnd,
      steps,
      screenshot_after: true,
    },
    input.signal,
  )
  return { flowName, hwnd, actionCount: actions.length, output }
}

export async function findGameWindow(
  profile: GameProfile,
  requestedHwnd: string | undefined,
  signal?: AbortSignal,
): Promise<ComputerUseWindow> {
  const output = await runWindowsComputerUse({ action: 'list_windows' }, signal)
  const windows = output.windows ?? []
  const selected = selectGameWindowCandidate(profile, windows, requestedHwnd)
  if (!selected) {
    throw new Error(
      requestedHwnd
        ? `Game window ${requestedHwnd} is not visible.`
        : 'No visible window matches the GameModel profile. Provide hwnd or update the profile title/process patterns.',
    )
  }
  if (selected.blockedReason) {
    throw new Error(`Game window is blocked: ${selected.blockedReason}`)
  }
  return selected
}

export function selectGameWindowCandidate(
  profile: GameProfile,
  windows: ComputerUseWindow[],
  requestedHwnd?: string,
): ComputerUseWindow | undefined {
  if (requestedHwnd) {
    return windows.find((window) => window.hwnd === requestedHwnd)
  }
  const candidates = windows.filter((window) =>
    matchesProfileWindow(profile, window),
  )
  return (
    candidates.find(
      (window) =>
        !window.blockedReason && matchesProfileProcess(profile, window),
    ) ??
    candidates.find((window) => !window.blockedReason) ??
    candidates[0]
  )
}

function matchesProfileWindow(
  profile: GameProfile,
  window: { title: string; processName: string },
): boolean {
  const title = normalizeWindowToken(window.title)
  const processName = window.processName.toLowerCase()
  const titleMatch = profile.window.titlePatterns.some((pattern) => {
    const normalizedPattern = normalizeWindowToken(pattern)
    return normalizedPattern.length > 0 && title.includes(normalizedPattern)
  })
  const processMatch = matchesProfileProcess(profile, { processName })
  return titleMatch || processMatch
}

function matchesProfileProcess(
  profile: GameProfile,
  window: { processName: string },
): boolean {
  const processName = window.processName.toLowerCase()
  return profile.window.processNames.some(
    (pattern) => processName === pattern.toLowerCase(),
  )
}

function normalizeWindowToken(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function toComputerUseSteps(
  action: GameMenuAction,
  width: number,
  height: number,
): ComputerUseStep[] {
  switch (action.type) {
    case 'click':
    case 'double_click': {
      const steps: ComputerUseStep[] = [
        {
          action: action.type,
          x: Math.round(action.xRatio * width),
          y: Math.round(action.yRatio * height),
        },
      ]
      if ((action.delayAfterMs ?? 0) > 0) {
        steps.push({ action: 'wait', duration_ms: action.delayAfterMs })
      }
      return steps
    }
    case 'press_key': {
      const steps: ComputerUseStep[] = [
        { action: 'press_key', key: action.key },
      ]
      if ((action.delayAfterMs ?? 0) > 0) {
        steps.push({ action: 'wait', duration_ms: action.delayAfterMs })
      }
      return steps
    }
    case 'wait':
      return [{ action: 'wait', duration_ms: action.durationMs }]
  }
}

function normalizeFlowName(flowName: string): string {
  return flowName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
}
