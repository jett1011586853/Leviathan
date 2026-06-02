import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPluginsDirectory } from '../utils/plugins/pluginDirectories.js'

const originalEnv = {
  LEVIATHAN_CONFIG_DIR: process.env.LEVIATHAN_CONFIG_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  LEVIATHAN_CODE_PLUGIN_CACHE_DIR: process.env.LEVIATHAN_CODE_PLUGIN_CACHE_DIR,
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

function withTempDirs<T>(fn: (dirs: { legacy: string; leviathan: string }) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'leviathan-plugin-storage-'))
  try {
    return fn({
      legacy: join(root, 'legacy-claude'),
      leviathan: join(root, 'leviathan'),
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('Leviathan plugin storage', () => {
  test('uses the Leviathan config directory before the legacy Claude config directory', () => {
    withTempDirs(({ legacy, leviathan }) => {
      process.env.CLAUDE_CONFIG_DIR = legacy
      process.env.LEVIATHAN_CONFIG_DIR = leviathan
      delete process.env.LEVIATHAN_CODE_PLUGIN_CACHE_DIR

      expect(getPluginsDirectory()).toBe(join(leviathan, 'plugins'))
    })
  })

  test('uses the Leviathan plugin cache override', () => {
    withTempDirs(({ leviathan }) => {
      process.env.LEVIATHAN_CODE_PLUGIN_CACHE_DIR = join(leviathan, 'plugins')

      expect(getPluginsDirectory()).toBe(join(leviathan, 'plugins'))
    })
  })
})
