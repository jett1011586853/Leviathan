import { createRequire } from 'node:module'
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
type NativeColorModuleCandidate = {
  ColorDiff?: unknown
  ColorFile?: unknown
  getSyntaxTheme?: unknown
}
type NativeColorModuleShape = NativeColorModuleCandidate & {
  default?: NativeColorModuleCandidate
}

const requireNativeModule = createRequire(import.meta.url)
let cachedNativeModule: ColorModule | null | undefined

function hasRenderMethod(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    typeof (value as { prototype?: { render?: unknown } }).prototype?.render ===
      'function'
  )
}

function normalizeNativeColorModule(
  candidate: NativeColorModuleCandidate | undefined,
): ColorModule | null {
  if (
    hasRenderMethod(candidate?.ColorDiff) &&
    hasRenderMethod(candidate?.ColorFile) &&
    typeof candidate?.getSyntaxTheme === 'function'
  ) {
    return {
      ColorDiff: candidate.ColorDiff as ColorDiffConstructor,
      ColorFile: candidate.ColorFile as ColorFileConstructor,
      getSyntaxTheme: candidate.getSyntaxTheme as ColorModule['getSyntaxTheme'],
    }
  }
  return null
}

function loadNativeColorModule(): ColorModule | null {
  if (cachedNativeModule !== undefined) return cachedNativeModule

  try {
    const nativeModule = requireNativeModule(
      'color-diff-napi',
    ) as NativeColorModuleShape
    cachedNativeModule =
      normalizeNativeColorModule(nativeModule) ??
      normalizeNativeColorModule(nativeModule.default)
  } catch {
    cachedNativeModule = null
  }

  return cachedNativeModule
}

function getColorModule(): ColorModule | null {
  if (getColorModuleUnavailableReason() !== null) return null

  const nativeModule = loadNativeColorModule()
  if (nativeModule) return nativeModule

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
