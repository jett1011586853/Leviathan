import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../leviathan/branding.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js'
import type { Message } from '../types/message.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import type { BridgeState, ReplBridgeHandle } from './replBridge.js'

export type InitBridgeOptions = {
  onInboundMessage?: (msg: SDKMessage) => void | Promise<void>
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  initialMessages?: Message[]
  initialName?: string
  getMessages?: () => Message[]
  previouslyFlushedUUIDs?: Set<string>
  perpetual?: boolean
  outboundOnly?: boolean
  tags?: string[]
}

export async function initReplBridge(
  options?: InitBridgeOptions,
): Promise<ReplBridgeHandle | null> {
  options?.onStateChange?.('failed', LEGACY_ACCOUNT_FEATURE_NOTICE)
  return null
}
