import {
  ColorDiff as NativeColorDiff,
  ColorFile as NativeColorFile,
  getSyntaxTheme as nativeGetSyntaxTheme,
} from 'color-diff-napi'
import {
  ColorDiff as TypeScriptColorDiff,
  ColorFile as TypeScriptColorFile,
  getSyntaxTheme as typeScriptGetSyntaxTheme,
  type SyntaxTheme,
} from '../../native-ts/color-diff/index.js'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

export type ColorModuleUnavailableReason = 'env'

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via LEVIATHAN_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.LEVIATHAN_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

type ColorDiffConstructor = typeof TypeScriptColorDiff
type ColorFileConstructor = typeof TypeScriptColorFile
type ColorModule = {
  ColorDiff: ColorDiffConstructor
  ColorFile: ColorFileConstructor
  getSyntaxTheme(themeName: string): SyntaxTheme | null
}

function hasRenderMethod(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    typeof (value as { prototype?: { render?: unknown } }).prototype?.render ===
      'function'
  )
}

function getColorModule(): ColorModule | null {
  if (getColorModuleUnavailableReason() !== null) return null

  if (hasRenderMethod(NativeColorDiff) && hasRenderMethod(NativeColorFile)) {
    return {
      ColorDiff: NativeColorDiff as ColorDiffConstructor,
      ColorFile: NativeColorFile as ColorFileConstructor,
      getSyntaxTheme: nativeGetSyntaxTheme as ColorModule['getSyntaxTheme'],
    }
  }

  return {
    ColorDiff: TypeScriptColorDiff,
    ColorFile: TypeScriptColorFile,
    getSyntaxTheme: typeScriptGetSyntaxTheme,
  }
}

export function expectColorDiff(): ColorDiffConstructor | null {
  return getColorModule()?.ColorDiff ?? null
}

export function expectColorFile(): ColorFileConstructor | null {
  return getColorModule()?.ColorFile ?? null
}

export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  return getColorModule()?.getSyntaxTheme(themeName) ?? null
}
