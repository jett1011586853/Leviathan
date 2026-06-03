import type { Message } from '../types/message.js'
import { redactText, redactValue } from './redaction.js'
import {
  type CreateRolloutBundleInput,
  type LeviathanRolloutBundle,
  type RolloutToolEvent,
  createEmptyRolloutBundle,
} from './rolloutSchema.js'

export type BuildConversationRolloutBundleInput = Omit<
  CreateRolloutBundleInput,
  'userInstruction'
> & {
  messages: Message[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object'
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      return block.text
    }
  }

  return ''
}

function extractFirstUserInstruction(messages: Message[]): string {
  for (const message of messages) {
    if (message.type !== 'user') continue
    const text = extractTextContent(message.message.content).trim()
    if (text) return redactText(text)
  }
  return ''
}

function messageContent(message: Message): unknown {
  if (message.type === 'user') return message.message.content
  if (message.type === 'assistant') return message.message.content
  if (message.type === 'system') return message.content
  if (message.type === 'attachment') return message.attachment
  if (message.type === 'progress') return message.data
  if (message.type === 'tool_use_summary') return message.summary
  if (message.type === 'tombstone') return message.originalType
  return message
}

function messageRole(message: Message): string {
  if (message.type === 'assistant') return 'assistant'
  if (message.type === 'user') return 'user'
  if (message.type === 'system') return 'system'
  return message.type
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') return redactText(content)
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
    } else if (
      isRecord(block) &&
      block.type === 'text' &&
      typeof block.text === 'string'
    ) {
      parts.push(block.text)
    }
  }
  return redactText(parts.join('\n'))
}

function collectToolEvents(messages: Message[]): RolloutToolEvent[] {
  const events = new Map<string, RolloutToolEvent>()

  for (const message of messages) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (!isRecord(block) || block.type !== 'tool_use') continue
        const id = typeof block.id === 'string' ? block.id : ''
        if (!id) continue
        events.set(id, {
          tool_use_id: id,
          tool_name: typeof block.name === 'string' ? block.name : 'unknown',
          input_redacted: redactValue(block.input),
          success: null,
          result_summary: '',
        })
      }
    }

    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (!isRecord(block) || block.type !== 'tool_result') continue
        const id =
          typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        if (!id) continue
        const existing =
          events.get(id) ??
          ({
            tool_use_id: id,
            tool_name: 'unknown',
            input_redacted: {},
            success: null,
            result_summary: '',
          } satisfies RolloutToolEvent)
        existing.success = block.is_error === true ? false : true
        existing.result_summary = summarizeToolResult(block.content)
        events.set(id, existing)
      }
    }
  }

  return [...events.values()]
}

export function buildConversationRolloutBundle(
  input: BuildConversationRolloutBundleInput,
): LeviathanRolloutBundle {
  const bundle = createEmptyRolloutBundle({
    ...input,
    userInstruction: extractFirstUserInstruction(input.messages),
  })

  bundle.messages = input.messages.map(message => ({
    message_id: message.uuid,
    role: messageRole(message),
    timestamp: 'timestamp' in message ? message.timestamp : undefined,
    content: redactValue(messageContent(message)),
    ...(message.type === 'assistant' && {
      model: message.message.model,
      request_id: message.requestId,
    }),
  }))
  bundle.tool_events = collectToolEvents(input.messages)

  return bundle
}
