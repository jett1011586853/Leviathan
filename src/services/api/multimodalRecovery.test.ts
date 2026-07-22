import { describe, expect, test } from 'bun:test'
import { isTransientMultimodalProcessingError } from './errors.js'

const message = 'Multimodal data is corrupted or cannot be processed.'

describe('isTransientMultimodalProcessingError', () => {
  test('recognizes the known transient gateway 400 forms', () => {
    expect(
      isTransientMultimodalProcessingError({
        status: 400,
        message: `Request Error: ${message}`,
      }),
    ).toBe(true)
    expect(
      isTransientMultimodalProcessingError(
        new Error(
          `API Error: 400 {"error":{"code":"400","message":"${message}"}}`,
        ),
      ),
    ).toBe(true)
    expect(
      isTransientMultimodalProcessingError({
        error: { code: '400', message: 'Request Error', param: message },
      }),
    ).toBe(true)
  })

  test('does not retry unrelated or non-400 media failures', () => {
    expect(
      isTransientMultimodalProcessingError({
        status: 400,
        message: 'Invalid image format',
      }),
    ).toBe(false)
    expect(
      isTransientMultimodalProcessingError({ status: 422, message }),
    ).toBe(false)
  })
})
