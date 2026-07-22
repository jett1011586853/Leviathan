import { expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { CannotRetryError, withRetry } from './withRetry.js'

const transientMultimodalError = {
  status: 400,
  headers: { 'retry-after': '0' },
  error: {
    code: '400',
    message: 'Request Error',
    param: 'Multimodal data is corrupted or cannot be processed.',
  },
}

test('withRetry retries a transient multimodal 400 twice', async () => {
  let attempts = 0
  const generator = withRetry(
    async () => ({}) as Anthropic,
    async () => {
      attempts += 1
      if (attempts <= 2) throw transientMultimodalError
      return 'recovered'
    },
    {
      maxRetries: 0,
      model: 'test-model',
      thinkingConfig: { type: 'disabled' },
    },
  )

  while (true) {
    const result = await generator.next()
    if (result.done) {
      expect(result.value).toBe('recovered')
      break
    }
  }

  expect(attempts).toBe(3)
})

test('withRetry stops after the bounded multimodal retry limit', async () => {
  let attempts = 0
  const generator = withRetry(
    async () => ({}) as Anthropic,
    async () => {
      attempts += 1
      throw transientMultimodalError
    },
    {
      maxRetries: 10,
      model: 'test-model',
      thinkingConfig: { type: 'disabled' },
    },
  )

  let caught: unknown
  try {
    while (!(await generator.next()).done) {
      // Retry messages are optional for non-SDK test errors.
    }
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(CannotRetryError)
  expect(attempts).toBe(3)
})
