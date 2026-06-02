import { buildTool } from '../../Tool.js'

const stub = buildTool({
  name: 'MonitorTool',
  async description() { return 'Stub tool' },
  async prompt() { return '' },
  inputSchema: { type: 'object' as const, properties: {} },
  isEnabled: () => false,
  async call() { return { type: 'text' as const, value: '' } }
})

export { stub as MonitorTool }
