import type {
  ActiveGameModelMode,
  GameProfile,
  GameRuntimeSummary,
} from './types.js'

export type GameSidecarStartParams = {
  sessionId: string
  cwd: string
  sessionDir: string
  controlMode: ActiveGameModelMode
  objective: string
  profile: GameProfile
  profilePath: string
  hwnd?: string
  parentPid: number
}

export type GameSidecarRequest =
  | {
      id: string
      method: 'start'
      params: GameSidecarStartParams
    }
  | {
      id: string
      method: 'set_goal'
      params: { objective: string }
    }
  | {
      id: string
      method: 'get_summary' | 'pause' | 'resume' | 'stop' | 'ping'
      params?: Record<string, never>
    }

export type GameSidecarResponse = {
  type: 'response'
  id: string
  ok: boolean
  data?: GameRuntimeSummary | { pong: true }
  error?: string
}

export type GameSidecarEvent = {
  type: 'event'
  event: {
    sessionId?: string
    timestamp: string
    name: string
    data?: Record<string, unknown>
  }
}

export type GameSidecarMessage = GameSidecarResponse | GameSidecarEvent
