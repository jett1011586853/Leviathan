import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { AwmpTraceEvent } from './types.js'

export async function appendTraceEvent(
  tracePath: string,
  event: AwmpTraceEvent,
): Promise<void> {
  await mkdir(dirname(tracePath), { recursive: true })
  await appendFile(tracePath, `${JSON.stringify(event)}\n`, 'utf8')
}

export function createTraceEvent(input: {
  traceId: string
  taskId: string
  modeId?: string
  capsuleId?: string
  event: string
  actor?: string
  riskLevel?: string
  data?: Record<string, unknown>
}): AwmpTraceEvent {
  return {
    traceId: input.traceId,
    taskId: input.taskId,
    modeId: input.modeId,
    capsuleId: input.capsuleId,
    event: input.event,
    timestamp: new Date().toISOString(),
    actor: input.actor ?? 'leviathan-awmp-runtime',
    riskLevel: input.riskLevel,
    data: input.data,
  }
}
