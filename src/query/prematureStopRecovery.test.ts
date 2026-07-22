import { describe, expect, test } from 'bun:test'
import {
  buildPrematureStopRecoveryPrompt,
  decidePrematureStopRecovery,
  isRecoverablePrematureStopReason,
  MAX_PREMATURE_STOP_RECOVERY_ATTEMPTS,
} from './prematureStopRecovery.js'

describe('isRecoverablePrematureStopReason', () => {
  test('recognizes provider repetition truncation variants', () => {
    expect(isRecoverablePrematureStopReason('repetition_truncation')).toBe(true)
    expect(isRecoverablePrematureStopReason(' Repetition_Truncation ')).toBe(
      true,
    )
  })

  test('does not reinterpret normal completion or unknown values', () => {
    expect(isRecoverablePrematureStopReason('end_turn')).toBe(false)
    expect(isRecoverablePrematureStopReason('tool_use')).toBe(false)
    expect(isRecoverablePrematureStopReason(undefined)).toBe(false)
  })
})

test('buildPrematureStopRecoveryPrompt resumes without replaying work', () => {
  const prompt = buildPrematureStopRecoveryPrompt(
    'repetition_truncation',
    1,
  )

  expect(prompt).toContain('latest verified state')
  expect(prompt).toContain('Do not repeat')
  expect(prompt).toContain(
    `Recovery attempt 1/${MAX_PREMATURE_STOP_RECOVERY_ATTEMPTS}`,
  )
})

test('decidePrematureStopRecovery permits two attempts and then stops', () => {
  expect(decidePrematureStopRecovery('repetition_truncation', 0)).toMatchObject(
    { action: 'recover', attempt: 1 },
  )
  expect(decidePrematureStopRecovery('repetition_truncation', 1)).toMatchObject(
    { action: 'recover', attempt: 2 },
  )
  expect(decidePrematureStopRecovery('repetition_truncation', 2)).toEqual({
    action: 'exhausted',
    attempts: 2,
  })
  expect(decidePrematureStopRecovery('end_turn', 0)).toEqual({
    action: 'not_applicable',
  })
})
