export const MAX_PREMATURE_STOP_RECOVERY_ATTEMPTS = 2

const RECOVERABLE_PREMATURE_STOP_REASONS = new Set([
  'repetition_truncation',
])

export function isRecoverablePrematureStopReason(
  stopReason: unknown,
): stopReason is string {
  return (
    typeof stopReason === 'string' &&
    RECOVERABLE_PREMATURE_STOP_REASONS.has(stopReason.trim().toLowerCase())
  )
}

export function buildPrematureStopRecoveryPrompt(
  stopReason: string,
  attempt: number,
  maxAttempts = MAX_PREMATURE_STOP_RECOVERY_ATTEMPTS,
): string {
  return [
    `The provider stopped the previous response early (${stopReason}) before a user-visible completion.`,
    'Resume the unfinished task from the latest verified state.',
    'Do not repeat prior reasoning or repeat completed actions.',
    'Continue using tools when work remains.',
    'If the task is complete, verify it and provide a concise final result.',
    'Do not end with thinking-only output.',
    `Recovery attempt ${attempt}/${maxAttempts}.`,
  ].join(' ')
}

export type PrematureStopRecoveryDecision =
  | { action: 'not_applicable' }
  | { action: 'recover'; attempt: number; prompt: string }
  | { action: 'exhausted'; attempts: number }

export function decidePrematureStopRecovery(
  stopReason: unknown,
  completedAttempts: number,
  maxAttempts = MAX_PREMATURE_STOP_RECOVERY_ATTEMPTS,
): PrematureStopRecoveryDecision {
  if (!isRecoverablePrematureStopReason(stopReason)) {
    return { action: 'not_applicable' }
  }

  if (completedAttempts >= maxAttempts) {
    return { action: 'exhausted', attempts: completedAttempts }
  }

  const attempt = completedAttempts + 1
  return {
    action: 'recover',
    attempt,
    prompt: buildPrematureStopRecoveryPrompt(
      stopReason,
      attempt,
      maxAttempts,
    ),
  }
}
