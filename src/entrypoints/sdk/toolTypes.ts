import type { ToolInputJSONSchema } from '../../Tool.js'

/**
 * @internal SDK tool type definitions — not yet stabilized for public API.
 */
export interface SDKToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema
}
