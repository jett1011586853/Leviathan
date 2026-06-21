import { afterEach, describe, expect, test } from 'bun:test'

import {
  EFFORT_LEVELS,
  modelSupportsMaxEffort,
  parseEffortValue,
  resolveAppliedEffort,
  toPersistableEffort,
} from './effort.js'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('effort levels', () => {
  test('includes max as a first-class level', () => {
    expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'max'])
    expect(parseEffortValue('max')).toBe('max')
    expect(toPersistableEffort('max')).toBe('max')
  })

  test('preserves max for DeepSeek models', () => {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.LEVIATHAN_CODE_ALWAYS_ENABLE_EFFORT
    delete process.env.LEVIATHAN_CODE_ALWAYS_ENABLE_MAX_EFFORT

    expect(modelSupportsMaxEffort('deepseek-v4-pro')).toBe(true)
    expect(resolveAppliedEffort('deepseek-v4-pro', 'max')).toBe('max')
  })

  test('preserves max for custom Anthropic-compatible gateways', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://example.com/anthropic'
    delete process.env.LEVIATHAN_CODE_ALWAYS_ENABLE_EFFORT
    delete process.env.LEVIATHAN_CODE_ALWAYS_ENABLE_MAX_EFFORT

    expect(modelSupportsMaxEffort('mimo-v2.5')).toBe(true)
    expect(resolveAppliedEffort('mimo-v2.5', 'max')).toBe('max')
  })

  test('can force max effort support explicitly', () => {
    delete process.env.ANTHROPIC_BASE_URL
    process.env.LEVIATHAN_CODE_ALWAYS_ENABLE_MAX_EFFORT = 'true'

    expect(modelSupportsMaxEffort('unknown-model')).toBe(true)
    expect(resolveAppliedEffort('unknown-model', 'max')).toBe('max')
  })

  test('downgrades max for known unsupported Claude models', () => {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.LEVIATHAN_CODE_ALWAYS_ENABLE_EFFORT
    delete process.env.LEVIATHAN_CODE_ALWAYS_ENABLE_MAX_EFFORT

    expect(modelSupportsMaxEffort('claude-3-5-sonnet')).toBe(false)
    expect(resolveAppliedEffort('claude-3-5-sonnet', 'max')).toBe('high')
  })
})
