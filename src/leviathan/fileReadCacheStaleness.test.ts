import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readFileSyncCached } from '../utils/file.js'
import { fileReadCache } from '../utils/fileReadCache.js'

describe('Leviathan file read cache staleness', () => {
  const dirs: string[] = []

  afterEach(() => {
    fileReadCache.clear()
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('invalidates when file content changes even if mtime is preserved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leviathan-file-cache-'))
    dirs.push(dir)
    const filePath = join(dir, 'sample.txt')
    const fixedTimestamp = new Date('2024-01-01T00:00:00.000Z')

    writeFileSync(filePath, 'alpha', 'utf8')
    utimesSync(filePath, fixedTimestamp, fixedTimestamp)

    expect(readFileSyncCached(filePath)).toBe('alpha')
    const firstStat = statSync(filePath)

    await new Promise(resolve => setTimeout(resolve, 20))
    writeFileSync(filePath, 'omega', 'utf8')
    utimesSync(filePath, fixedTimestamp, fixedTimestamp)

    const secondStat = statSync(filePath)
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
    expect(readFileSync(filePath, 'utf8')).toBe('omega')
    expect(readFileSyncCached(filePath)).toBe('omega')
  })
})
