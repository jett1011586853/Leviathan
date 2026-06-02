import type { MCPServerConnection } from '../services/mcp/types.js'
import type { PermissionMode } from '../types/permissions.js'

/**
 * Legacy browser-account prompt bridge is disabled in Leviathan.
 */
export function usePromptsFromLeviathanBrowser(
  _mcpClients: MCPServerConnection[],
  _toolPermissionMode: PermissionMode,
): void {}
