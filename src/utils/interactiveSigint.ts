export const INTERACTIVE_SIGINT_CONFIRMATION_WINDOW_MS = 800

export type InteractiveSigintDecision = {
  action: 'ignore' | 'shutdown'
  nextSignalAt: number | undefined
}

/**
 * Raw-mode Ctrl+C is handled by the REPL. A process-level SIGINT in an
 * interactive session is therefore usually leaked by a child shell or a
 * transient terminal-mode switch. Require a second signal before exiting so
 * one leaked event cannot kill the whole CLI.
 */
export function decideInteractiveSigint(
  isInteractive: boolean,
  now: number,
  previousSignalAt: number | undefined,
  confirmationWindowMs = INTERACTIVE_SIGINT_CONFIRMATION_WINDOW_MS,
): InteractiveSigintDecision {
  if (!isInteractive) {
    return { action: 'shutdown', nextSignalAt: undefined }
  }

  if (
    previousSignalAt !== undefined &&
    now >= previousSignalAt &&
    now - previousSignalAt <= confirmationWindowMs
  ) {
    return { action: 'shutdown', nextSignalAt: undefined }
  }

  return { action: 'ignore', nextSignalAt: now }
}
