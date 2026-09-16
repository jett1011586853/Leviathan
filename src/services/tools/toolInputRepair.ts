/**
 * Schema-driven repair pass for model-generated tool arguments.
 *
 * Why this exists: tool inputs are validated with `inputSchema.safeParse()`,
 * and any deviation - a typed value that arrived as a string, a stray key that
 * a `z.strictObject` rejects, a number just past a documented maximum, a
 * stringified JSON object for a nested parameter - failed the entire call.
 * The model then had to retry from scratch, which is slow and, on gateways
 * that stringify nested arguments, frequently impossible to get right on the
 * first try.
 *
 * The repair pass runs only after a failed parse. It never invents data: it
 * coerces between equivalent representations, renames parameters that match a
 * schema property under a normalized name, drops keys the schema does not
 * accept, and clamps numeric bounds. Anything it cannot fix is left alone so
 * the caller still reports a normal validation error.
 */

import type { ZodTypeAny } from 'zod/v4'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'

type JsonSchema = Record<string, unknown>

type RepairableTool = {
  name: string
  inputSchema: ZodTypeAny
}

export type ToolInputRepair = {
  input: Record<string, unknown>
  repairs: ToolInputRepairEntry[]
}

export type ToolInputRepairKind =
  | 'parsed-arguments'
  | 'parsed-object'
  | 'parsed-array'
  | 'coerced-number'
  | 'coerced-boolean'
  | 'clamped'
  | 'rounded'
  | 'normalized-enum'
  | 'renamed'
  | 'aliased'
  | 'dropped-unknown'

export type ToolInputRepairEntry = {
  kind: ToolInputRepairKind
  detail: string
}

/**
 * Escape hatch for anyone who would rather see the raw validation error than a
 * silently repaired call.
 */
export function isToolInputRepairEnabled(): boolean {
  return !isEnvTruthy(process.env.LEVIATHAN_CODE_DISABLE_TOOL_INPUT_REPAIR)
}

/** Parameter aliases we have seen models emit for well-known schema fields. */
const PARAMETER_ALIASES: Record<string, string[]> = {
  file_path: ['path', 'filepath', 'filename', 'file'],
  command: ['cmd'],
  expression: ['script', 'code'],
  selector: ['css', 'css_selector', 'query'],
  url: ['link', 'href'],
  timeout_ms: ['timeout', 'timeoutMs', 'timeout_ms'],
  old_string: ['old_str', 'oldString', 'search'],
  new_string: ['new_str', 'newString', 'replace'],
}

/** Keys that collapse to the same identity, e.g. filePath -> file_path. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaType(schema: JsonSchema): string | null {
  const type = schema.type
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    const first = type.find(value => typeof value === 'string')
    return typeof first === 'string' ? first : null
  }
  return null
}

function subschemas(schema: JsonSchema): JsonSchema[] {
  const result: JsonSchema[] = []
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const value = schema[keyword]
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isPlainObject(entry)) result.push(entry)
      }
    }
  }
  return result
}

function numericBounds(schema: JsonSchema): {
  minimum?: number
  maximum?: number
} {
  const bounds: { minimum?: number; maximum?: number } = {}
  if (typeof schema.minimum === 'number') bounds.minimum = schema.minimum
  if (typeof schema.maximum === 'number') bounds.maximum = schema.maximum
  return bounds
}

/**
 * Parse a value that a model emitted as a JSON string. Returns null when the
 * string is not valid JSON (so we do not turn arbitrary text into data).
 */
function tryParseJsonString(value: string): unknown | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  if (!looksLikeJson) return null
  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function repairValue(
  schema: JsonSchema,
  value: unknown,
  path: string,
  repairs: ToolInputRepairEntry[],
): unknown {
  // Unions: repair against the branch that matches the value's shape.
  const branches = subschemas(schema)
  if (branches.length > 0) {
    const branchType = schemaType(schema)
    for (const branch of branches) {
      const wanted = schemaType(branch)
      if (wanted === 'object' && isPlainObject(value) && !branchType) {
        return repairValue(branch, value, path, repairs)
      }
      if (typeof value === 'string' && wanted !== 'string') {
        const parsed = tryParseJsonString(value)
        if (parsed !== null) {
          repairs.push({
            kind: 'parsed-object',
            detail: `parsed stringified ${wanted ?? 'value'} at ${path}`,
          })
          return repairValue(branch, parsed, path, repairs)
        }
      }
      if (wanted && typeof value === wanted) {
        return repairValue(branch, value, path, repairs)
      }
    }
  }

  const type = schemaType(schema)

  // Nested object that arrived as a JSON string. This is the shape gateways
  // produce when they stringify nested tool arguments (e.g. cdp_params).
  if (type === 'object') {
    if (typeof value === 'string') {
      const parsed = tryParseJsonString(value)
      if (isPlainObject(parsed)) {
        repairs.push({
          kind: 'parsed-object',
          detail: `parsed stringified object at ${path}`,
        })
        return repairObject(schema, parsed, path, repairs)
      }
      return value
    }
    if (isPlainObject(value)) {
      return repairObject(schema, value, path, repairs)
    }
    return value
  }

  if (type === 'array') {
    if (typeof value === 'string') {
      const parsed = tryParseJsonString(value)
      if (Array.isArray(parsed)) {
        repairs.push({
          kind: 'parsed-array',
          detail: `parsed stringified array at ${path}`,
        })
        return parsed
      }
    }
    return value
  }

  if (type === 'integer' || type === 'number') {
    let numeric: unknown = value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        repairs.push({
          kind: 'coerced-number',
          detail: `coerced numeric string "${value}" to number at ${path}`,
        })
        numeric = parsed
      }
    }
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
      return numeric
    }

    let bounded = numeric
    const { minimum, maximum } = numericBounds(schema)
    if (minimum !== undefined && bounded < minimum) {
      repairs.push({
        kind: 'clamped',
        detail: `clamped ${path} ${bounded} -> ${minimum} (minimum)`,
      })
      bounded = minimum
    }
    if (maximum !== undefined && bounded > maximum) {
      repairs.push({
        kind: 'clamped',
        detail: `clamped ${path} ${bounded} -> ${maximum} (maximum)`,
      })
      bounded = maximum
    }
    if (type === 'integer' && !Number.isInteger(bounded)) {
      const rounded = Math.round(bounded)
      repairs.push({
        kind: 'rounded',
        detail: `rounded ${path} ${bounded} -> ${rounded}`,
      })
      bounded = rounded
    }
    return bounded
  }

  if (type === 'boolean' && typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true' || lowered === '1') {
      repairs.push({
        kind: 'coerced-boolean',
        detail: `coerced boolean string "${value}" to true at ${path}`,
      })
      return true
    }
    if (lowered === 'false' || lowered === '0') {
      repairs.push({
        kind: 'coerced-boolean',
        detail: `coerced boolean string "${value}" to false at ${path}`,
      })
      return false
    }
    return value
  }

  // Enum values are compared exactly by zod, so trailing whitespace or a
  // different case from the model used to reject the call outright.
  const enumValues = schema.enum
  if (Array.isArray(enumValues) && typeof value === 'string') {
    const exact = enumValues.find(entry => entry === value)
    if (exact === undefined) {
      const normalized = value.trim()
      const match = enumValues.find(
        entry =>
          typeof entry === 'string' &&
          entry.toLowerCase() === normalized.toLowerCase(),
      )
      if (typeof match === 'string') {
        repairs.push({
          kind: 'normalized-enum',
          detail: `normalized enum ${path} "${value}" -> "${match}"`,
        })
        return match
      }
    }
  }

  return value
}

function repairObject(
  schema: JsonSchema,
  input: Record<string, unknown>,
  path: string,
  repairs: ToolInputRepairEntry[],
): Record<string, unknown> {
  const properties = isPlainObject(schema.properties)
    ? (schema.properties as Record<string, JsonSchema>)
    : null
  if (!properties) return input

  const additionalProperties = schema.additionalProperties
  const rejectsUnknown = additionalProperties === false
  const result: Record<string, unknown> = {}
  const usedKeys = new Set<string>()

  // First pass: exact and normalized matches.
  const pending: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(input)) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      result[key] = repairValue(
        properties[key] ?? {},
        value,
        path ? `${path}.${key}` : key,
        repairs,
      )
      usedKeys.add(key)
      continue
    }

    const normalized = normalizeKey(key)
    const normalizedMatch = Object.keys(properties).find(
      candidate => normalizeKey(candidate) === normalized,
    )
    if (normalizedMatch) {
      result[normalizedMatch] = repairValue(
        properties[normalizedMatch] ?? {},
        value,
        path ? `${path}.${normalizedMatch}` : normalizedMatch,
        repairs,
      )
      usedKeys.add(normalizedMatch)
      repairs.push({
        kind: 'renamed',
        detail: `renamed parameter ${key} -> ${normalizedMatch}`,
      })
      continue
    }

    pending.push([key, value])
  }

  // Second pass: alias table, only when the canonical field is still absent.
  for (const [key, value] of pending) {
    const canonical = Object.keys(properties).find(property =>
      (PARAMETER_ALIASES[property] ?? []).some(
        alias => normalizeKey(alias) === normalizeKey(key),
      ),
    )
    if (canonical && !usedKeys.has(canonical)) {
      result[canonical] = repairValue(
        properties[canonical] ?? {},
        value,
        path ? `${path}.${canonical}` : canonical,
        repairs,
      )
      usedKeys.add(canonical)
      repairs.push({
        kind: 'aliased',
        detail: `mapped parameter ${key} -> ${canonical}`,
      })
      continue
    }

    if (!rejectsUnknown) {
      result[key] = value
      continue
    }
    repairs.push({
      kind: 'dropped-unknown',
      detail: `dropped unknown parameter ${path ? `${path}.` : ''}${key}`,
    })
  }

  return result
}

/**
 * Attempt to repair a failed tool input. Returns null when nothing could be
 * changed, so callers can fall straight through to the original error.
 */
export function repairToolInput(
  tool: RepairableTool,
  input: unknown,
): ToolInputRepair | null {
  let working: unknown = input
  const repairs: ToolInputRepairEntry[] = []

  // Some gateways deliver the entire argument object as a JSON string.
  if (typeof working === 'string') {
    const parsed = tryParseJsonString(working)
    if (isPlainObject(parsed)) {
      repairs.push({
        kind: 'parsed-arguments',
        detail: 'parsed stringified argument object',
      })
      working = parsed
    } else {
      return null
    }
  }

  if (!isPlainObject(working)) return null

  let schema: JsonSchema
  try {
    schema = zodToJsonSchema(tool.inputSchema) as JsonSchema
  } catch (error) {
    logForDebugging(
      `${tool.name}: could not derive JSON schema for input repair: ${String(error)}`,
    )
    return null
  }

  const repaired = repairObject(schema, working, '', repairs)
  if (repairs.length === 0) return null

  return { input: repaired, repairs }
}
