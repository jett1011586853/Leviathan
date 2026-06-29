import { describe, expect, test } from 'bun:test'
import goal from '../commands/goal/index.js'
import { call } from '../commands/goal/goal.js'

describe('/goal command', () => {
  test('registers as a local JSX slash command', () => {
    expect(goal.name).toBe('goal')
    expect(goal.type).toBe('local-jsx')
    expect(goal.description).toContain('goal mode')
  })

  test('direct objective starts goal mode and submits model-visible context', async () => {
    let captured:
      | {
          result: string | undefined
          options: Record<string, unknown> | undefined
        }
      | undefined

    const rendered = await call(
      (result, options) => {
        captured = { result, options }
      },
      // The direct path does not read command context.
      {} as Parameters<typeof call>[1],
      'finish the release and verify startup',
    )

    expect(rendered).toBeNull()
    expect(captured?.result).toContain('Goal mode started.')
    expect(captured?.options?.display).toBe('system')
    expect(captured?.options?.shouldQuery).toBe(true)

    const metaMessages = captured?.options?.metaMessages as string[]
    expect(metaMessages).toHaveLength(1)
    expect(metaMessages[0]).toContain('Leviathan Goal Mode')
    expect(metaMessages[0]).toContain(
      'Final goal: finish the release and verify startup',
    )
  })

  test('empty invocation renders the guided goal dialog', async () => {
    const rendered = await call(
      () => {},
      // The dialog path only needs onDone until the user submits.
      {} as Parameters<typeof call>[1],
      '',
    )

    expect(Boolean(rendered)).toBe(true)
    expect((rendered as { type?: { name?: string } })?.type?.name).toBe(
      'GoalDialog',
    )
  })
})
