import type { FrontmatterData } from './frontmatterParser.js'
import { logForDebugging } from './debug.js'
import type {
  SkillAutoTrigger,
  SkillLifecycle,
  SkillRuntimePolicy,
} from '../types/skill.js'

const MAX_TRIGGER_PHRASES = 32
const MAX_TRIGGER_LENGTH = 160
const MAX_REMINDER_TURNS = 50
const DEFAULT_REMINDER_TURNS = 12

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function getLeviathanMetadata(
  frontmatter: FrontmatterData,
): Record<string, unknown> | undefined {
  return asRecord(asRecord(frontmatter.metadata)?.leviathan)
}

export function getSkillWhenToUse(
  frontmatter: FrontmatterData,
): string | undefined {
  const metadata = asRecord(frontmatter.metadata)
  const value = metadata?.when_to_use ?? frontmatter.when_to_use
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseStringList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  return [
    ...new Set(
      raw
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim()),
    ),
  ]
    .filter(item => item.length >= 2 && item.length <= MAX_TRIGGER_LENGTH)
    .slice(0, MAX_TRIGGER_PHRASES)
}

function parseAutoTrigger(value: unknown): SkillAutoTrigger | undefined {
  if (typeof value === 'string' || Array.isArray(value)) {
    const phrases = parseStringList(value)
    return phrases.length > 0 ? { phrases } : undefined
  }

  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const phrases = parseStringList(record.phrases)
  if (phrases.length === 0) return undefined

  const exclude = parseStringList(record.exclude)
  return exclude.length > 0 ? { phrases, exclude } : { phrases }
}

function parseLifecycle(
  value: unknown,
  skillName: string,
): SkillLifecycle | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'turn' || value === 'task') return value
  logForDebugging(
    `Skill ${skillName} has invalid leviathan-lifecycle '${String(value)}'. Valid options: turn, task`,
  )
  return undefined
}

function parseReminderTurns(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(1, Math.min(MAX_REMINDER_TURNS, Math.floor(parsed)))
}

export function parseSkillRuntimePolicy(
  frontmatter: FrontmatterData,
  skillName: string,
): SkillRuntimePolicy | undefined {
  const leviathan = getLeviathanMetadata(frontmatter)
  const autoTrigger = parseAutoTrigger(
    leviathan?.auto_trigger ?? frontmatter['leviathan-auto-trigger'],
  )
  const lifecycle = parseLifecycle(
    leviathan?.lifecycle ?? frontmatter['leviathan-lifecycle'],
    skillName,
  )
  const reminderValue =
    leviathan?.reminder ?? frontmatter['leviathan-reminder']
  const reminder =
    typeof reminderValue === 'string'
      ? reminderValue.trim()
      : undefined
  const reminderTurns = parseReminderTurns(
    leviathan?.reminder_turns ?? frontmatter['leviathan-reminder-turns'],
  )

  if (!autoTrigger && !lifecycle && !reminder && !reminderTurns) {
    return undefined
  }

  return {
    ...(autoTrigger ? { autoTrigger } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(reminder ? { reminder } : {}),
    ...(lifecycle === 'task' || reminder
      ? { reminderTurns: reminderTurns ?? DEFAULT_REMINDER_TURNS }
      : reminderTurns
        ? { reminderTurns }
        : {}),
  }
}
