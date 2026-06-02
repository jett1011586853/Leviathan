import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

/**
 * Connector text blocks are opaque content blocks that pass through
 * from MCP servers or other external sources without modification.
 * Guarded by the CONNECTOR_TEXT feature flag.
 */
export interface ConnectorTextBlock {
  type: 'connector_text'
  text: string
  provider?: string
  [key: string]: unknown
}

export interface ConnectorTextDelta {
  type: 'connector_text_delta'
  text: string
  index: number
}

export function isConnectorTextBlock(
  block: ContentBlockParam | ConnectorTextBlock,
): block is ConnectorTextBlock {
  return block.type === 'connector_text'
}
