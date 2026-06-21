import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ensureInstallationLeviathanMd,
  getInstallationLeviathanMdPath,
  getLeviathanInstallationRoot,
  INSTALLATION_INSTRUCTIONS_FILENAME,
} from './installationInstructions.js'

const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'leviathan-installation-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('installation-wide Leviathan instructions', () => {
  test('resolves the installation root from a nested CLI entry point', async () => {
    const installationRoot = await createTemporaryDirectory()
    const entryDirectory = join(installationRoot, 'src', 'entrypoints')
    const entryPath = join(entryDirectory, 'cli.tsx')

    await mkdir(entryDirectory, { recursive: true })
    await writeFile(
      join(installationRoot, 'package.json'),
      JSON.stringify({ name: 'leviathan' }),
    )
    await writeFile(entryPath, '')

    expect(getLeviathanInstallationRoot(entryPath, entryPath)).toBe(
      installationRoot,
    )
  })

  test('creates lowercase leviathan.md without replacing existing content', async () => {
    const installationRoot = await createTemporaryDirectory()
    const expectedPath = join(
      installationRoot,
      INSTALLATION_INSTRUCTIONS_FILENAME,
    )

    const first = await ensureInstallationLeviathanMd(installationRoot)
    expect(first).toEqual({ path: expectedPath, created: true })
    expect(getInstallationLeviathanMdPath(installationRoot)).toBe(expectedPath)

    await writeFile(expectedPath, 'Always use PowerShell.\n')
    const second = await ensureInstallationLeviathanMd(installationRoot)

    expect(second).toEqual({ path: expectedPath, created: false })
    expect(await readFile(expectedPath, 'utf8')).toBe(
      'Always use PowerShell.\n',
    )
  })
})
