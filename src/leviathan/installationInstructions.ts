import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join, parse, resolve } from 'path'
import { getErrnoCode } from '../utils/errors.js'

export const INSTALLATION_INSTRUCTIONS_FILENAME = 'leviathan.md'

const INSTALLATION_INSTRUCTIONS_TEMPLATE = `<!--
Leviathan installation-wide preferences

Write durable instructions below this comment. Leviathan loads this file at
the start of every session, regardless of the workspace you launch it from.

Good uses include preferred workflows, coding conventions, response style,
and commands you want Leviathan to use consistently. Do not store API keys or
other secrets here.
-->
`

function isLeviathanPackage(packagePath: string): boolean {
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      name?: unknown
    }
    return (
      packageJson.name === 'leviathan' ||
      (typeof packageJson.name === 'string' &&
        packageJson.name.endsWith('/leviathan'))
    )
  } catch {
    return false
  }
}

export function getLeviathanInstallationRoot(
  entryPath: string | undefined =
    typeof Bun !== 'undefined' ? Bun.main : process.argv[1],
  executablePath: string | undefined = process.execPath,
): string {
  const configuredRoot = process.env.LEVIATHAN_CODE_INSTALL_ROOT?.trim()
  if (configuredRoot) {
    return resolve(configuredRoot)
  }

  const resolvedEntryPath = resolve(entryPath || executablePath || '.')
  let currentDir = dirname(resolvedEntryPath)

  while (true) {
    if (isLeviathanPackage(join(currentDir, 'package.json'))) {
      return currentDir
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir || currentDir === parse(currentDir).root) {
      break
    }
    currentDir = parentDir
  }

  return dirname(resolve(executablePath || resolvedEntryPath))
}

export function getInstallationLeviathanMdPath(
  installationRoot: string = getLeviathanInstallationRoot(),
): string {
  return join(installationRoot, INSTALLATION_INSTRUCTIONS_FILENAME)
}

export async function ensureInstallationLeviathanMd(
  installationRoot: string = getLeviathanInstallationRoot(),
): Promise<{ path: string; created: boolean }> {
  const filePath = getInstallationLeviathanMdPath(installationRoot)
  await mkdir(installationRoot, { recursive: true })

  try {
    await writeFile(filePath, INSTALLATION_INSTRUCTIONS_TEMPLATE, {
      encoding: 'utf8',
      flag: 'wx',
    })
    return { path: filePath, created: true }
  } catch (error) {
    if (getErrnoCode(error) === 'EEXIST') {
      return { path: filePath, created: false }
    }
    throw error
  }
}
