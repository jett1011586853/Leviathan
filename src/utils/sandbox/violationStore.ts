import type { SandboxViolationEvent } from './sandbox-adapter.js'

export type SandboxViolationStoreLike = {
  subscribe?: (
    listener: (violations?: SandboxViolationEvent[]) => void,
  ) => void | (() => void)
  getTotalCount?: () => number
  getViolations?: () => SandboxViolationEvent[]
  getAllViolations?: () => SandboxViolationEvent[]
  violations?: SandboxViolationEvent[]
}

export function readSandboxViolations(
  store: SandboxViolationStoreLike,
): SandboxViolationEvent[] {
  try {
    if (typeof store.getViolations === 'function') {
      return store.getViolations()
    }
    if (typeof store.getAllViolations === 'function') {
      return store.getAllViolations()
    }
    if (Array.isArray(store.violations)) {
      return store.violations
    }
  } catch {
    return []
  }
  return []
}

export function getSandboxViolationTotal(
  store: SandboxViolationStoreLike,
  violations: SandboxViolationEvent[] = readSandboxViolations(store),
): number {
  try {
    if (typeof store.getTotalCount === 'function') {
      return store.getTotalCount()
    }
  } catch {
    return violations.length
  }
  return violations.length
}

export function subscribeToSandboxViolations(
  store: SandboxViolationStoreLike,
  listener: (violations: SandboxViolationEvent[]) => void,
  pollMs = 1000,
): () => void {
  const refresh = (violations?: SandboxViolationEvent[]) => {
    listener(Array.isArray(violations) ? violations : readSandboxViolations(store))
  }

  refresh()

  if (typeof store.subscribe === 'function') {
    const unsubscribe = store.subscribe(refresh)
    return typeof unsubscribe === 'function' ? unsubscribe : () => {}
  }

  const timer = setInterval(refresh, pollMs)
  return () => clearInterval(timer)
}
