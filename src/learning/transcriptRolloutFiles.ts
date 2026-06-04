import { mkdirSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { buildConversationRolloutBundle } from './conversationRollout.js'
import type { LeviathanRolloutBundle, RolloutSplit } from './rolloutSchema.js'
import type { Message } from '../types/message.js'
import {
  buildConversationChain,
  loadTranscriptFile,
} from '../utils/sessionStorage.js'
import {
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../utils/slowOperations.js'

export type WriteTranscriptRolloutFileInput = {
  transcript_path: string
  output_path: string
  run_id: string
  task_id: string
  split: RolloutSplit
  provider_model_id: string
  harness_version: string
  heuristic_bundle_version: string
  repo: string
  base_commit: string
  cwd_alias?: string
}

export type WriteTranscriptRolloutFileResult = {
  output_path: string
  rollout: LeviathanRolloutBundle
}

function transcriptSessionId(path: string): string {
  return basename(path).replace(/\.jsonl$/i, '')
}

function messageSessionId(messages: Message[], fallback: string): string {
  for (const message of messages) {
    const sessionId = (message as { sessionId?: unknown }).sessionId
    if (typeof sessionId === 'string' && sessionId.length > 0) return sessionId
  }
  return fallback
}

function messageTimestamp(messages: Message[]): string {
  const last = messages.at(-1) as { timestamp?: unknown } | undefined
  return typeof last?.timestamp === 'string'
    ? last.timestamp
    : new Date().toISOString()
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync_DEPRECATED(path, jsonStringify(value, null, 2), {
    encoding: 'utf-8',
    flush: true,
  })
}

export async function writeTranscriptRolloutFile(
  input: WriteTranscriptRolloutFileInput,
): Promise<WriteTranscriptRolloutFileResult> {
  const loaded = await loadTranscriptFile(input.transcript_path)
  const leaf = [...loaded.leafUuids]
    .map(uuid => loaded.messages.get(uuid))
    .filter(message => message !== undefined)
    .at(-1)

  if (!leaf) {
    throw new Error(`Transcript has no conversation leaf: ${input.transcript_path}`)
  }

  const messages = buildConversationChain(
    loaded.messages,
    leaf,
  ) as unknown as Message[]
  const sessionId = messageSessionId(
    messages,
    transcriptSessionId(input.transcript_path),
  )
  const rollout = buildConversationRolloutBundle({
    messages,
    runId: input.run_id,
    sessionId,
    taskId: input.task_id,
    source: 'internal',
    split: input.split,
    timestamp: messageTimestamp(messages),
    harnessVersion: input.harness_version,
    heuristicBundleVersion: input.heuristic_bundle_version,
    policyVersion: input.provider_model_id,
    repo: input.repo,
    baseCommit: input.base_commit,
    cwdAlias: input.cwd_alias ?? '$WORKDIR',
  })

  writeJson(input.output_path, rollout)
  return {
    output_path: input.output_path,
    rollout,
  }
}
