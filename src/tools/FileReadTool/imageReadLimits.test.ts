import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, test } from 'bun:test'

import {
  assertImageWithinByteLimit,
  MAX_IMAGE_BYTES,
} from './imageReadLimits.js'

describe('readImageWithTokenBudget', () => {
  test('rejects oversized images before loading them fully', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'leviathan-image-limit-'))
    const imagePath = join(dir, 'huge.jpg')

    try {
      await writeFile(imagePath, Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff))

      await expect(assertImageWithinByteLimit(imagePath)).rejects.toThrow(
        /Image too large/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
