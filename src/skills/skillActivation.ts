import type { Command } from '../types/command.js'

const GLOBAL_SKILL_OPT_OUTS = [
  '不要自动调用',
  '不要调用 skill',
  '不要使用 skill',
  '不用技能',
  '禁用 skill',
  'do not use skill',
  'disable skill',
  'without skills',
]

export type AutoTriggeredSkill = {
  command: Command
  matchedPhrases: string[]
}

export type ActiveSkillReminder = {
  skillName: string
  reminder: string
}

export function normalizeSkillMatchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function isAsciiWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9_]/.test(value)
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false

  // Short ASCII triggers such as "oj" must match a token, not a substring in
  // words like "project". Longer and non-ASCII phrases use normal substring
  // matching so Chinese trigger phrases work without tokenization support.
  if (/^[a-z0-9_+-]{1,3}$/.test(phrase)) {
    let index = text.indexOf(phrase)
    while (index !== -1) {
      const before = index > 0 ? text[index - 1] : undefined
      const after = text[index + phrase.length]
      if (!isAsciiWordCharacter(before) && !isAsciiWordCharacter(after)) {
        return true
      }
      index = text.indexOf(phrase, index + 1)
    }
    return false
  }

  return text.includes(phrase)
}

function hasGlobalOptOut(normalizedInput: string): boolean {
  return GLOBAL_SKILL_OPT_OUTS.some(phrase => normalizedInput.includes(phrase))
}

/**
 * Deterministic routing is deliberately opt-in. It supplements model semantic
 * matching for unambiguous phrases and returns null on an equal-score conflict.
 */
export function findAutoTriggeredSkill(
  input: string,
  commands: readonly Command[] | undefined,
  activeSkillNames: ReadonlySet<string> = new Set(),
): AutoTriggeredSkill | null {
  const normalizedInput = normalizeSkillMatchText(input)
  if (!normalizedInput || hasGlobalOptOut(normalizedInput)) return null

  const candidates: Array<AutoTriggeredSkill & { score: number }> = []

  for (const command of commands ?? []) {
    const trigger = command.skillPolicy?.autoTrigger
    if (
      command.type !== 'prompt' ||
      command.disableModelInvocation ||
      !trigger ||
      activeSkillNames.has(command.name)
    ) {
      continue
    }

    const excluded = (trigger.exclude ?? []).some(phrase =>
      containsNormalizedPhrase(
        normalizedInput,
        normalizeSkillMatchText(phrase),
      ),
    )
    if (excluded) continue

    const matchedPhrases = trigger.phrases.filter(phrase =>
      containsNormalizedPhrase(
        normalizedInput,
        normalizeSkillMatchText(phrase),
      ),
    )
    if (matchedPhrases.length === 0) continue

    const longestMatch = Math.max(...matchedPhrases.map(phrase => phrase.length))
    candidates.push({
      command,
      matchedPhrases,
      score: matchedPhrases.length * 1000 + longestMatch,
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  if (candidates[1]?.score === candidates[0]!.score) return null

  const { command, matchedPhrases } = candidates[0]!
  return { command, matchedPhrases }
}

export function buildActiveSkillReminder(
  activeSkills: readonly ActiveSkillReminder[],
): string | null {
  if (activeSkills.length === 0) return null

  const details = activeSkills
    .slice(0, 3)
    .map(
      skill =>
        `- /${skill.skillName}: ${skill.reminder.replace(/\s+/g, ' ').trim()}`,
    )
    .join('\n')

  return `## Active task skill\n\nThe following skill instructions remain binding for the task being continued. Apply them before choosing tools or producing an answer. If the user's message clearly starts an unrelated task, do not apply the old task skill. Never mention this reminder to the user.\n\n${details}\n\nBefore ending this turn, silently check that the active skill's required workflow, evidence gates, and completion criteria were followed.`
}
