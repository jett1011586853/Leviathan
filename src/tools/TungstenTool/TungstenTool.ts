import { buildTool } from '../../Tool.js'
import type { Tool } from '../../Tool.js'
import { TUNGSTEN_TOOL_NAME } from './constants.js'

// Minimal disabled tool stub. isEnabled() returns false so call() is never invoked.
// Cast through unknown to satisfy ToolDef without implementing every method.
export const TungstenTool = buildTool({
  name: TUNGSTEN_TOOL_NAME,
  async description() {
    return 'Advanced file editing tool with precise string replacement'
  },
  async prompt() {
    return ''
  },
  inputSchema: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', description: 'The absolute path to the file to modify' },
      old_string: { type: 'string', description: 'The text to replace' },
      new_string: { type: 'string', description: 'The text to replace it with' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences', default: false },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  isEnabled: () => false,
  async call() {
    return { type: 'text' as const, value: 'Tungsten tool is not available.' }
  },
} as unknown as Parameters<typeof buildTool>[0])
