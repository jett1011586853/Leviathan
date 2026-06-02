import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isXaaEnabled } from '../services/mcp/xaaIdpLogin.js'

const originalEnv = {
  LEVIATHAN_CODE_ENABLE_XAA: process.env.LEVIATHAN_CODE_ENABLE_XAA,
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

describe('Leviathan MCP identity', () => {
  test('XAA enablement uses the Leviathan env var only', () => {
    delete process.env.LEVIATHAN_CODE_ENABLE_XAA
    process.env.LEVIATHAN_CODE_ENABLE_XAA = '1'
    expect(isXaaEnabled()).toBe(true)
  })

  test('MCP OAuth and XAA visible copy identifies Leviathan', () => {
    const auth = readFileSync(
      new URL('../services/mcp/auth.ts', import.meta.url),
      'utf8',
    )
    const xaa = readFileSync(
      new URL('../services/mcp/xaaIdpLogin.ts', import.meta.url),
      'utf8',
    )
    const sources = `${auth}\n${xaa}`

    expect(sources).not.toContain('claude mcp xaa')
    expect(sources).not.toContain('Return to donk')
    expect(sources).not.toContain('client_name: `donk')
    expect(sources).toContain('leviathan mcp xaa')
    expect(sources).toContain('Return to Leviathan')
    expect(sources).toContain('client_name: `Leviathan')
  })
})
