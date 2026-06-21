export type AssistantSession = {
  id: string
  name?: string
  cwd?: string
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  return []
}
