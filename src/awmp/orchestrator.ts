import { writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { appendTraceEvent, createTraceEvent } from './trace.js'
import type {
  AwmpOrchestrationRecord,
  AwmpOrchestrationStep,
  AwmpTask,
  TaskState,
} from './types.js'

export async function startAwmpOrchestration(input: {
  runDir: string
  tracePath: string
  task: AwmpTask
  traceId: string
}): Promise<AwmpOrchestrationRecord> {
  const now = new Date().toISOString()
  const record: AwmpOrchestrationRecord = {
    awmp: '0.1',
    kind: 'OrchestrationRecord',
    id: `orch_${input.task.id}`,
    taskId: input.task.id,
    traceId: input.traceId,
    currentState: input.task.status.state,
    startedAt: now,
    updatedAt: now,
    path: join(resolve(input.runDir), 'orchestration.json'),
    steps: [],
  }
  await writeOrchestrationRecord(record)
  await appendOrchestrationTrace({
    tracePath: input.tracePath,
    record,
    state: input.task.status.state,
    message: 'AWMP orchestration started.',
  })
  return record
}

export async function transitionAwmpOrchestration(
  record: AwmpOrchestrationRecord,
  input: {
    tracePath: string
    state: TaskState
    message: string
    data?: Record<string, unknown>
  },
): Promise<AwmpOrchestrationRecord> {
  const now = new Date().toISOString()
  const step: AwmpOrchestrationStep = {
    state: input.state,
    status: 'completed',
    startedAt: now,
    completedAt: now,
    message: input.message,
    data: input.data,
  }
  const updated: AwmpOrchestrationRecord = {
    ...record,
    currentState: input.state,
    updatedAt: now,
    steps: [...record.steps, step],
  }
  await writeOrchestrationRecord(updated)
  await appendOrchestrationTrace({
    tracePath: input.tracePath,
    record: updated,
    state: input.state,
    message: input.message,
    data: input.data,
  })
  return updated
}

export async function completeAwmpOrchestration(
  record: AwmpOrchestrationRecord,
  input: {
    tracePath: string
    state: Extract<TaskState, 'completed' | 'failed' | 'canceled' | 'rejected'>
    message: string
    data?: Record<string, unknown>
  },
): Promise<AwmpOrchestrationRecord> {
  const updated = await transitionAwmpOrchestration(record, input)
  const completed: AwmpOrchestrationRecord = {
    ...updated,
    completedAt: new Date().toISOString(),
  }
  await writeOrchestrationRecord(completed)
  return completed
}

async function writeOrchestrationRecord(
  record: AwmpOrchestrationRecord,
): Promise<void> {
  await writeFile(record.path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

async function appendOrchestrationTrace(input: {
  tracePath: string
  record: AwmpOrchestrationRecord
  state: TaskState
  message: string
  data?: Record<string, unknown>
}): Promise<void> {
  await appendTraceEvent(
    input.tracePath,
    createTraceEvent({
      traceId: input.record.traceId,
      taskId: input.record.taskId,
      event: 'orchestrator.transition',
      data: {
        orchestrationId: input.record.id,
        state: input.state,
        message: input.message,
        ...(input.data ?? {}),
      },
    }),
  )
}
