import type { Tool } from '../../Tool.js'

export const LocalWorkflowTask: Tool = {
  name: 'LocalWorkflowTask',
  async description() { return '' },
  async prompt() { return '' },
  inputSchema: { type: 'object' as const, properties: {} },
  isEnabled: () => false,
  async call() { return { type: 'text' as const, value: '' } },
}
