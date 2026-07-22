import { GAME_MODEL_TOOL_NAME } from '../tools/GameModelTool/constants.js'

export const GAME_MODEL_FEATURE_TOOL_NAMES = new Set([GAME_MODEL_TOOL_NAME])

export function filterGameModelFeatureTools<T extends { name: string }>(
  tools: readonly T[],
  enabled: boolean,
): T[] {
  if (enabled) return [...tools]
  return tools.filter(tool => !GAME_MODEL_FEATURE_TOOL_NAMES.has(tool.name))
}

export function hasGameModelFeatureTools(
  tools: readonly { name: string }[],
): boolean {
  return tools.some(tool => GAME_MODEL_FEATURE_TOOL_NAMES.has(tool.name))
}
