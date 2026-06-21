import type { Message } from '../../types/message.js'

export type ContextCollapseStats = {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: {
    totalSpawns: number
    totalErrors: number
    totalEmptySpawns: number
    emptySpawnWarningEmitted: boolean
    lastError?: string
  }
}

const EMPTY_STATS: ContextCollapseStats = {
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalSpawns: 0,
    totalErrors: 0,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  },
}

export function isContextCollapseEnabled(): boolean {
  return false
}

export function getStats(): ContextCollapseStats {
  return EMPTY_STATS
}

export function subscribe(_listener: () => void): () => void {
  return () => {}
}

export function resetContextCollapse(): void {}

export async function applyCollapsesIfNeeded<T extends Message[]>(
  messages: T,
): Promise<{ messages: T }> {
  return { messages }
}

export function isWithheldPromptTooLong(): boolean {
  return false
}

export function recoverFromOverflow<T extends Message[]>(
  messages: T,
): { messages: T; committed: number } {
  return { messages, committed: 0 }
}
