import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  isToolInputRepairEnabled,
  repairToolInput,
} from '../services/tools/toolInputRepair.js'

const editingTool = {
  name: 'TestEdit',
  inputSchema: z.strictObject({
    file_path: z.string(),
    timeout_ms: z.number().int().min(500).max(180_000).optional(),
    replace_all: z.boolean().optional(),
    edits: z
      .array(z.object({ old_string: z.string(), new_string: z.string() }))
      .optional(),
    cdp_params: z.record(z.string(), z.unknown()).optional(),
  }),
}

describe('tool input repair', () => {
  test('parses a nested object that arrived as a JSON string', () => {
    const repair = repairToolInput(editingTool, {
      file_path: 'a.txt',
      cdp_params: '{"depth":1,"nested":{"x":[1,2]}}',
    })

    expect(repair).not.toBeNull()
    expect(repair!.input.cdp_params).toEqual({
      depth: 1,
      nested: { x: [1, 2] },
    })
    expect(repair!.repairs.map(entry => entry.kind)).toContain('parsed-object')
    expect(editingTool.inputSchema.safeParse(repair!.input).success).toBe(true)
  })

  test('drops unknown parameters for strict schemas', () => {
    const repair = repairToolInput(editingTool, {
      file_path: 'a.txt',
      content: 'leftover from another tool',
      subagent_type: 'worker',
    })

    expect(repair).not.toBeNull()
    expect(repair!.input).toEqual({ file_path: 'a.txt' })
    expect(
      repair!.repairs.filter(entry => entry.kind === 'dropped-unknown'),
    ).toHaveLength(2)
    expect(editingTool.inputSchema.safeParse(repair!.input).success).toBe(true)
  })

  test('coerces numeric strings and clamps out-of-range values', () => {
    const stringRepair = repairToolInput(editingTool, {
      file_path: 'a.txt',
      timeout_ms: '30000',
    })
    expect(stringRepair!.input.timeout_ms).toBe(30_000)
    expect(stringRepair!.repairs.map(entry => entry.kind)).toContain(
      'coerced-number',
    )

    const clamped = repairToolInput(editingTool, {
      file_path: 'a.txt',
      timeout_ms: 600_000,
    })
    expect(clamped!.input.timeout_ms).toBe(180_000)
    expect(clamped!.repairs.map(entry => entry.kind)).toContain('clamped')
    expect(editingTool.inputSchema.safeParse(clamped!.input).success).toBe(true)
  })

  test('normalizes enum casing and whitespace', () => {
    const tool = {
      name: 'TestAction',
      inputSchema: z.strictObject({
        action: z.enum(['snapshot', 'click']),
      }),
    }

    const repair = repairToolInput(tool, { action: ' Click ' })
    expect(repair!.input.action).toBe('click')
    expect(repair!.repairs.map(entry => entry.kind)).toContain(
      'normalized-enum',
    )
    expect(tool.inputSchema.safeParse(repair!.input).success).toBe(true)
  })

  test('renames near-miss and aliased parameter names', () => {
    const nearMiss = repairToolInput(editingTool, {
      filePath: 'a.txt',
    })
    expect(nearMiss!.input).toEqual({ file_path: 'a.txt' })
    expect(nearMiss!.repairs.map(entry => entry.kind)).toContain('renamed')

    const alias = repairToolInput(editingTool, {
      path: 'a.txt',
    })
    expect(alias!.input).toEqual({ file_path: 'a.txt' })
    expect(alias!.repairs.map(entry => entry.kind)).toContain('aliased')
  })

  test('parses a whole argument object delivered as a JSON string', () => {
    const repair = repairToolInput(editingTool, '{"file_path":"a.txt"}')
    expect(repair!.input).toEqual({ file_path: 'a.txt' })
    expect(repair!.repairs.map(entry => entry.kind)).toContain(
      'parsed-arguments',
    )
  })

  test('returns null when the input needs no repair', () => {
    expect(repairToolInput(editingTool, { file_path: 'a.txt' })).toBeNull()
    expect(repairToolInput(editingTool, 'not json at all')).toBeNull()
    expect(repairToolInput(editingTool, { unrelated: true })).not.toBeNull()
  })

  test('leaves malformed nested JSON alone instead of inventing data', () => {
    const repair = repairToolInput(editingTool, {
      file_path: 'a.txt',
      cdp_params: '{"unterminated": ',
    })
    expect(repair).toBeNull()
  })

  test('honors the disable switch', () => {
    expect(isToolInputRepairEnabled()).toBe(true)
    process.env.LEVIATHAN_CODE_DISABLE_TOOL_INPUT_REPAIR = '1'
    try {
      expect(isToolInputRepairEnabled()).toBe(false)
    } finally {
      delete process.env.LEVIATHAN_CODE_DISABLE_TOOL_INPUT_REPAIR
    }
  })
})
