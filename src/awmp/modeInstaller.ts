import { cp, mkdir, rm, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { loadModePackage } from './modeRegistry.js'
import { getAwmpStateRoot, sanitizePathSegment } from './paths.js'
import type { AwmpModePackage } from './types.js'

export type InstallModeResult = {
  modePackage: AwmpModePackage
  installedRoot: string
  replaced: boolean
}

export async function installModePackage(options: {
  sourceDir: string
  cwd?: string
  force?: boolean
}): Promise<InstallModeResult> {
  const sourceRoot = resolve(options.sourceDir)
  const modePackage = await loadModePackage(sourceRoot)
  const modesRoot = join(getAwmpStateRoot(options.cwd), 'modes')
  const installedRoot = join(modesRoot, sanitizePathSegment(modePackage.mode.id))
  const sourceKey = sourceRoot.toLowerCase()
  const installedKey = resolve(installedRoot).toLowerCase()

  if (sourceKey === installedKey) {
    return {
      modePackage,
      installedRoot,
      replaced: false,
    }
  }

  const alreadyInstalled = await exists(installedRoot)
  if (alreadyInstalled && !options.force) {
    throw new Error(
      `Mode ${modePackage.mode.id} is already installed at ${installedRoot}. Use --force to replace it.`,
    )
  }

  await mkdir(modesRoot, { recursive: true })
  if (alreadyInstalled) {
    await rm(installedRoot, { recursive: true, force: true })
  }
  await cp(sourceRoot, installedRoot, {
    recursive: true,
    errorOnExist: false,
    force: true,
  })

  return {
    modePackage: await loadModePackage(installedRoot),
    installedRoot,
    replaced: alreadyInstalled,
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
