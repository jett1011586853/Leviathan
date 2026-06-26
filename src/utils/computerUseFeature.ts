import type { Tools } from '../Tool.js'
import { BROWSER_DEVTOOLS_TOOL_NAME } from '../tools/BrowserDevToolsTool/constants.js'
import { COMPUTER_USE_TOOL_NAME } from '../tools/ComputerUseTool/constants.js'

export const COMPUTER_USE_FEATURE_TOOL_NAMES = new Set([
  COMPUTER_USE_TOOL_NAME,
  BROWSER_DEVTOOLS_TOOL_NAME,
])

export function filterComputerUseFeatureTools<T extends { name: string }>(
  tools: readonly T[],
  enabled: boolean,
): T[] {
  if (enabled) return [...tools]
  return tools.filter(tool => !COMPUTER_USE_FEATURE_TOOL_NAMES.has(tool.name))
}

export function hasComputerUseFeatureTools(tools: Tools): boolean {
  return tools.some(tool => COMPUTER_USE_FEATURE_TOOL_NAMES.has(tool.name))
}
