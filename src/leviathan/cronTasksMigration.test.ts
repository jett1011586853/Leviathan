import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCronFilePath,
  getCronFilePaths,
  getLegacyCronFilePath,
  hasCronTasksSync,
  readCronTasks,
  removeCronTasks,
  writeCronTasks,
} from '../utils/cronTasks.js'

async function withTempProject<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-cron-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeTaskFile(path: string, tasks: unknown[]): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ tasks }), 'utf8')
}

describe('Leviathan cron task storage migration', () => {
  test('reads legacy cron tasks while preferring Leviathan tasks with the same id', async () => {
    await withTempProject(async dir => {
      writeTaskFile(getLegacyCronFilePath(dir), [
        {
          id: 'legacy',
          cron: '*/5 * * * *',
          prompt: 'legacy only',
          createdAt: 1,
        },
        {
          id: 'shared',
          cron: '*/10 * * * *',
          prompt: 'legacy shared',
          createdAt: 2,
        },
      ])
      writeTaskFile(getCronFilePath(dir), [
        {
          id: 'shared',
          cron: '*/15 * * * *',
          prompt: 'leviathan shared',
          createdAt: 3,
        },
        {
          id: 'leviathan',
          cron: '*/20 * * * *',
          prompt: 'leviathan only',
          createdAt: 4,
        },
      ])

      const tasks = await readCronTasks(dir)
      const byId = new Map(tasks.map(task => [task.id, task]))

      expect(getCronFilePaths(dir)).toEqual([
        getLegacyCronFilePath(dir),
        getCronFilePath(dir),
      ])
      expect(byId.get('legacy')?.prompt).toBe('legacy only')
      expect(byId.get('shared')?.prompt).toBe('leviathan shared')
      expect(byId.get('leviathan')?.prompt).toBe('leviathan only')
      expect(tasks).toHaveLength(3)
    })
  })

  test('writes durable cron tasks only to the Leviathan path', async () => {
    await withTempProject(async dir => {
      await writeCronTasks(
        [
          {
            id: 'newtask',
            cron: '*/5 * * * *',
            prompt: 'new task',
            createdAt: 1,
            durable: false,
          },
        ],
        dir,
      )

      expect(getCronFilePath(dir)).toContain(join('.leviathan', 'scheduled_tasks.json'))
      expect(getLegacyCronFilePath(dir)).toContain(join('.claude', 'scheduled_tasks.json'))
      expect(existsSync(getCronFilePath(dir))).toBe(true)
      expect(existsSync(getLegacyCronFilePath(dir))).toBe(false)
      expect(readFileSync(getCronFilePath(dir), 'utf8')).not.toContain('durable')
      expect(hasCronTasksSync(dir)).toBe(true)
    })
  })

  test('deleting a migrated legacy cron task does not restore it from the legacy file', async () => {
    await withTempProject(async dir => {
      writeTaskFile(getLegacyCronFilePath(dir), [
        {
          id: 'legacy',
          cron: '*/5 * * * *',
          prompt: 'legacy only',
          createdAt: 1,
        },
      ])

      await removeCronTasks(['legacy'], dir)

      expect(existsSync(getCronFilePath(dir))).toBe(true)
      expect(existsSync(getLegacyCronFilePath(dir))).toBe(false)
      expect(await readCronTasks(dir)).toEqual([])
      expect(hasCronTasksSync(dir)).toBe(false)
    })
  })
})
