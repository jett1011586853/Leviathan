import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'
import { getChromeSystemPrompt } from './prompt.js'

export function shouldEnableLeviathanBrowser(_chromeFlag?: boolean): boolean {
  return false
}

export function shouldAutoEnableLeviathanBrowser(): boolean {
  return false
}

export function setupLeviathanBrowser(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
  systemPrompt: string
} {
  return {
    mcpConfig: {},
    allowedTools: [],
    systemPrompt: getChromeSystemPrompt(),
  }
}

export async function installChromeNativeHostManifest(
  _manifestBinaryPath: string,
): Promise<void> {}

export async function isChromeExtensionInstalled(): Promise<boolean> {
  return false
}
