import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { FileWriteTool } from '../tools/FileWriteTool/FileWriteTool.js'
import { getFileModificationTime } from '../utils/file.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'

async function runFileWriteTool(filePath: string, content: string) {
  const readFileState = createFileStateCacheWithSizeLimit(10)
  if (existsSync(filePath)) {
    readFileState.set(filePath, {
      content: readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n'),
      timestamp: getFileModificationTime(filePath),
      offset: undefined,
      limit: undefined,
    })
  }

  await FileWriteTool.call(
    { file_path: filePath, content },
    {
      readFileState,
      updateFileHistoryState: () => {},
      dynamicSkillDirTriggers: new Set(),
    } as any,
    undefined as any,
    {
      uuid: randomUUID(),
    } as any,
  )
}

describe('Leviathan FileWrite line endings', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('preserves CRLF line endings when overwriting an existing CRLF file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leviathan-file-write-'))
    dirs.push(dir)
    const filePath = join(dir, 'windows.txt')
    writeFileSync(filePath, 'alpha\r\nbeta\r\n', 'utf8')

    await runFileWriteTool(filePath, 'gamma\ndelta\n')

    expect(readFileSync(filePath, 'utf8')).toBe('gamma\r\ndelta\r\n')
  })

  test('uses LF line endings when creating a new file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leviathan-file-write-'))
    dirs.push(dir)
    const filePath = join(dir, 'new.txt')

    await runFileWriteTool(filePath, 'alpha\nbeta\n')

    expect(readFileSync(filePath, 'utf8')).toBe('alpha\nbeta\n')
  })

  test('rejects complete writes that contain unresolved merge conflict markers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leviathan-file-write-'))
    dirs.push(dir)
    const filePath = join(dir, 'conflicted.txt')

    await expect(
      runFileWriteTool(
        filePath,
        'alpha\n<<<<<<< HEAD\nbeta\n=======\ngamma\n>>>>>>> branch\n',
      ),
    ).rejects.toThrow('Cannot write unresolved merge conflict markers')
    expect(existsSync(filePath)).toBe(false)
  })
})
