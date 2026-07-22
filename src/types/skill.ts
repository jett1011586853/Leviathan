export type SkillLifecycle = 'turn' | 'task'

/**
 * Optional deterministic trigger used only for high-confidence phrases.
 * Normal skill discovery still relies on the model-facing description.
 */
export type SkillAutoTrigger = {
  phrases: string[]
  exclude?: string[]
}

/** Leviathan extensions layered on top of the portable Agent Skills format. */
export type SkillRuntimePolicy = {
  autoTrigger?: SkillAutoTrigger
  lifecycle?: SkillLifecycle
  reminder?: string
  reminderTurns?: number
}
