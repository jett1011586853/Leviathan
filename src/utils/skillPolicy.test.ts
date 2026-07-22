import { describe, expect, test } from 'bun:test'
import { parseFrontmatter } from './frontmatterParser.js'
import {
  getSkillWhenToUse,
  parseSkillRuntimePolicy,
} from './skillPolicy.js'

describe('parseSkillRuntimePolicy', () => {
  test('parses deterministic triggers and task reminders', () => {
    const policy = parseSkillRuntimePolicy(
      {
        metadata: {
          when_to_use: 'Use for AI Coding tasks.',
          leviathan: {
            auto_trigger: {
              phrases: ['AI Coding', 'AI Coding', 'OJ'],
              exclude: ['设计 skill'],
            },
            lifecycle: 'task',
            reminder: 'Follow the evidence gate.',
            reminder_turns: 18,
          },
        },
      },
      'test-skill',
    )

    expect(policy?.autoTrigger?.phrases).toEqual(['AI Coding', 'OJ'])
    expect(policy?.autoTrigger?.exclude).toEqual(['设计 skill'])
    expect(policy?.lifecycle).toBe('task')
    expect(policy?.reminderTurns).toBe(18)
    expect(
      getSkillWhenToUse({
        metadata: { when_to_use: 'Use for AI Coding tasks.' },
      }),
    ).toBe('Use for AI Coding tasks.')
  })

  test('uses a bounded default reminder window', () => {
    expect(
      parseSkillRuntimePolicy(
        {
          'leviathan-lifecycle': 'task',
          'leviathan-reminder': 'Keep following the workflow.',
          'leviathan-reminder-turns': 500,
        },
        'test-skill',
      )?.reminderTurns,
    ).toBe(50)
  })

  test('keeps reading legacy top-level extensions', () => {
    const frontmatter = {
      when_to_use: 'Legacy trigger guidance.',
      'leviathan-auto-trigger': ['legacy phrase'],
      'leviathan-lifecycle': 'turn',
    }

    expect(getSkillWhenToUse(frontmatter)).toBe('Legacy trigger guidance.')
    expect(
      parseSkillRuntimePolicy(frontmatter, 'legacy-skill')?.autoTrigger
        ?.phrases,
    ).toEqual(['legacy phrase'])
  })

  test('reads the standards-compatible metadata namespace from YAML', () => {
    const { frontmatter } = parseFrontmatter(`---
name: example
description: Use for an example task.
metadata:
  when_to_use: Use when the user says example workflow.
  leviathan:
    auto_trigger:
      phrases:
        - example workflow
        - " example workflow "
    lifecycle: task
    reminder: Keep the example gate active.
    reminder_turns: 7
---
Body`)

    expect(getSkillWhenToUse(frontmatter)).toBe(
      'Use when the user says example workflow.',
    )
    expect(
      parseSkillRuntimePolicy(frontmatter, 'example')?.autoTrigger?.phrases,
    ).toEqual(['example workflow'])
    expect(
      parseSkillRuntimePolicy(frontmatter, 'example')?.reminderTurns,
    ).toBe(7)
  })
})
