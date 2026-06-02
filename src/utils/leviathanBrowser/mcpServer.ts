import { LEGACY_ACCOUNT_FEATURE_NOTICE } from '../../leviathan/branding.js'

export type LeviathanBrowserContext = {
  serverName: string
  env?: Record<string, string>
}

export function createChromeContext(
  env?: Record<string, string>,
): LeviathanBrowserContext {
  return {
    serverName: 'Leviathan Browser Automation',
    ...(env && { env }),
  }
}

export async function runLeviathanBrowserMcpServer(): Promise<void> {
  throw new Error(LEGACY_ACCOUNT_FEATURE_NOTICE)
}
