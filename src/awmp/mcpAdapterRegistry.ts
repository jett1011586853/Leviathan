import type { AwmpToolCallStatus } from './toolBroker.js'

export type AwmpMcpAdapterInput = {
  runDir: string
  modeId: string
  toolId: string
  toolName: string
  server: string
  tool: string
  input?: unknown
  timeoutMs?: number
}

export type AwmpMcpAdapterResult = {
  status?: Extract<AwmpToolCallStatus, 'completed' | 'failed'>
  message?: string
  data?: unknown
  stdout?: string
  stderr?: string
}

export type AwmpMcpAdapterHandler = (
  input: AwmpMcpAdapterInput,
) => Promise<AwmpMcpAdapterResult> | AwmpMcpAdapterResult

const handlers = new Map<string, AwmpMcpAdapterHandler>()

export function registerAwmpMcpAdapter(input: {
  server: string
  tool: string
  handler: AwmpMcpAdapterHandler
}): () => void {
  const key = adapterKey(input.server, input.tool)
  handlers.set(key, input.handler)
  return () => {
    if (handlers.get(key) === input.handler) {
      handlers.delete(key)
    }
  }
}

export function getAwmpMcpAdapter(input: {
  server: string
  tool: string
}): AwmpMcpAdapterHandler | undefined {
  return handlers.get(adapterKey(input.server, input.tool))
}

export function clearAwmpMcpAdaptersForTests(): void {
  handlers.clear()
}

function adapterKey(server: string, tool: string): string {
  return `${server.trim()}\u0000${tool.trim()}`
}
