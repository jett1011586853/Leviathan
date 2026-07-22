import { z } from 'zod'

export const AwmpValidatorSchema = z
  .object({
    id: z.string().min(1),
    command: z.string().min(1),
    blocking: z.boolean().optional(),
  })
  .passthrough()

export const AwmpModeSchema = z
  .object({
    awmp: z.literal('0.1'),
    kind: z.literal('Mode'),
    id: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().min(1),
    activation: z
      .object({
        intents: z.array(z.string()).default([]),
        examples: z.array(z.string()).optional(),
        antiExamples: z.array(z.string()).optional(),
      })
      .passthrough(),
    inputs: z
      .object({
        accepted: z.array(z.string()).optional(),
        schemas: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    outputs: z
      .object({
        artifacts: z
          .array(
            z
              .object({
                type: z.string().min(1),
                mediaType: z.string().min(1),
                schema: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
    tools: z
      .object({
        mcp: z.array(z.unknown()).optional(),
        openapi: z.array(z.unknown()).optional(),
        local: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    permissions: z
      .object({
        default: z.array(z.string()).optional(),
        requiresApproval: z.array(z.string()).optional(),
        denied: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    validators: z.array(AwmpValidatorSchema).optional(),
    handoffs: z
      .object({
        canDelegateTo: z.array(z.string()).optional(),
        canReceiveFrom: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export const AwmpTaskSchema = z
  .object({
    awmp: z.literal('0.1'),
    kind: z.literal('Task'),
    id: z.string().min(1),
    contextId: z.string().min(1),
    title: z.string().min(1),
    objective: z.string().min(1),
    modeIds: z.array(z.string()).default([]),
    inputs: z.record(z.string(), z.unknown()).optional(),
    status: z
      .object({
        state: z.enum([
          'submitted',
          'planning',
          'working',
          'validating',
          'approval_required',
          'input_required',
          'auth_required',
          'completed',
          'failed',
          'canceled',
          'rejected',
        ]),
        message: z.string().optional(),
        timestamp: z.string().optional(),
      })
      .passthrough(),
    constraints: z.record(z.string(), z.unknown()).optional(),
    artifacts: z.array(z.string()).optional(),
    traceId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const AwmpArtifactSchema = z
  .object({
    awmp: z.literal('0.1'),
    kind: z.literal('Artifact'),
    id: z.string().min(1),
    taskId: z.string().min(1),
    type: z.string().min(1),
    mediaType: z.string().min(1),
    uri: z.string().min(1),
    createdBy: z
      .object({
        modeId: z.string().min(1),
        agentId: z.string().min(1),
      })
      .passthrough(),
    lineage: z.array(z.string()).optional(),
    validation: z
      .object({
        status: z
          .enum(['unknown', 'pending', 'passed', 'failed', 'waived'])
          .optional(),
        validators: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    version: z.number().int().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const AwmpExecutionCapsuleSchema = z
  .object({
    awmp: z.literal('0.1'),
    kind: z.literal('ExecutionCapsule'),
    id: z.string().min(1),
    taskId: z.string().min(1),
    workspace: z.string().min(1),
    runtime: z.record(z.string(), z.unknown()),
    network: z
      .object({
        mode: z.enum(['deny', 'allowlist', 'open']).optional(),
        allow: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    filesystem: z.record(z.string(), z.unknown()).optional(),
    secrets: z.array(z.unknown()).optional(),
    limits: z.record(z.string(), z.unknown()),
  })
  .passthrough()
