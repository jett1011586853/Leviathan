import { afterEach, describe, expect, test } from 'bun:test'

import { subprocessEnv } from './subprocessEnv.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('subprocessEnv', () => {
  test('scrubs sensitive credentials by default', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'secret-token'
    process.env.ANTHROPIC_API_KEY = 'secret-api-key'
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-aws'
    delete process.env.LEVIATHAN_CODE_DISABLE_SUBPROCESS_ENV_SCRUB
    delete process.env.LEVIATHAN_CODE_SUBPROCESS_ENV_SCRUB

    const env = subprocessEnv()

    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test('allows explicit opt-out for advanced debugging', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'secret-token'
    process.env.LEVIATHAN_CODE_DISABLE_SUBPROCESS_ENV_SCRUB = 'true'
    delete process.env.LEVIATHAN_CODE_SUBPROCESS_ENV_SCRUB

    const env = subprocessEnv()

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('secret-token')
  })
})
