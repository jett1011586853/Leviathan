import { describe, expect, test } from 'bun:test'
import type { Command } from '../types/command.js'
import type { SkillRuntimePolicy } from '../types/skill.js'
import {
  buildActiveSkillReminder,
  findAutoTriggeredSkill,
} from './skillActivation.js'

function promptSkill(name: string, skillPolicy: SkillRuntimePolicy): Command {
  return {
    type: 'prompt',
    name,
    description: name,
    source: 'bundled',
    loadedFrom: 'bundled',
    progressMessage: 'running',
    contentLength: 0,
    userInvocable: true,
    disableModelInvocation: false,
    skillPolicy,
    async getPromptForCommand() {
      return [{ type: 'text', text: name }]
    },
  }
}

describe('findAutoTriggeredSkill', () => {
  const aiCoding = promptSkill('ai-coding-orchestrator', {
    autoTrigger: {
      phrases: ['AI Coding', 'OJ', '帮我做这道编程题'],
      exclude: ['设计 skill'],
    },
  })

  test('matches high-confidence Chinese and English trigger phrases', () => {
    expect(
      findAutoTriggeredSkill('请帮我做这道编程题', [aiCoding])?.command.name,
    ).toBe('ai-coding-orchestrator')
    expect(findAutoTriggeredSkill('Start an AI Coding run', [aiCoding])).not.toBe(
      null,
    )
  })

  test('treats short ASCII triggers as tokens', () => {
    expect(findAutoTriggeredSkill('solve this OJ task', [aiCoding])).not.toBe(null)
    expect(findAutoTriggeredSkill('update the project files', [aiCoding])).toBe(
      null,
    )
  })

  test('honors per-skill exclusions, global opt-out, and active state', () => {
    expect(findAutoTriggeredSkill('讨论 AI Coding 设计 skill', [aiCoding])).toBe(
      null,
    )
    expect(
      findAutoTriggeredSkill('不要自动调用，帮我做这道编程题', [aiCoding]),
    ).toBe(null)
    expect(
      findAutoTriggeredSkill(
        '帮我做这道编程题',
        [aiCoding],
        new Set(['ai-coding-orchestrator']),
      ),
    ).toBe(null)
  })

  test('does not choose between equal-score conflicting skills', () => {
    const other = promptSkill('other', {
      autoTrigger: { phrases: ['AI Coding'] },
    })
    expect(findAutoTriggeredSkill('AI Coding', [aiCoding, other])).toBe(null)
  })
})

test('buildActiveSkillReminder keeps a concise binding checkpoint', () => {
  const reminder = buildActiveSkillReminder([
    {
      skillName: 'ai-coding-orchestrator',
      reminder: 'Stay on the current L0-L9 stage and require test evidence.',
    },
  ])

  expect(reminder).toContain('/ai-coding-orchestrator')
  expect(reminder).toContain('L0-L9')
  expect(reminder).toContain('silently check')
})
