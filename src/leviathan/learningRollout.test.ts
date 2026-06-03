import { describe, expect, test } from 'bun:test'

import {
  OPTIONAL_ROLLOUT_FIELDS,
  POLAR_ONLY_ROLLOUT_FIELDS,
  ROLLOUT_SCHEMA_VERSION,
  createEmptyRolloutBundle,
} from '../learning/rolloutSchema.js'
import { buildConversationRolloutBundle } from '../learning/conversationRollout.js'
import { redactText, redactValue } from '../learning/redaction.js'
import type { Message } from '../types/message.js'

describe('Leviathan HL/Polar rollout schema', () => {
  test('creates a v1 rollout bundle with required fields and no fake trainer fields', () => {
    const bundle = createEmptyRolloutBundle({
      runId: 'run_001',
      sessionId: 'session_001',
      taskId: 'task_001',
      source: 'internal',
      split: 'train',
      timestamp: '2026-06-03T00:00:00.000Z',
      harnessVersion: 'git:abc123',
      heuristicBundleVersion: 'hb:initial',
      policyVersion: 'mimo-v2.5',
      userInstruction: 'fix the failing test',
      repo: 'leviathan',
      baseCommit: 'abc123',
      cwdAlias: '$WORKDIR',
    })

    expect(ROLLOUT_SCHEMA_VERSION).toBe('leviathan.rollout.v1')
    expect(bundle.schema_version).toBe(ROLLOUT_SCHEMA_VERSION)
    expect(bundle.run).toEqual({
      run_id: 'run_001',
      session_id: 'session_001',
      task_id: 'task_001',
      source: 'internal',
      split: 'train',
      timestamp: '2026-06-03T00:00:00.000Z',
      harness_version: 'git:abc123',
      heuristic_bundle_version: 'hb:initial',
      policy_version: 'mimo-v2.5',
    })
    expect(bundle.task).toEqual({
      user_instruction: 'fix the failing test',
      repo: 'leviathan',
      base_commit: 'abc123',
      cwd_alias: '$WORKDIR',
    })
    expect(bundle.messages).toEqual([])
    expect(bundle.tool_events).toEqual([])
    expect(bundle.code_changes.diff).toBe('')
    expect(bundle.evaluation.test_commands).toEqual([])
    expect(bundle.failure.taxonomy).toEqual([])
    expect(bundle.security.export_allowed).toBe(false)

    expect(OPTIONAL_ROLLOUT_FIELDS).toContain('response_logprobs')
    expect(POLAR_ONLY_ROLLOUT_FIELDS).toContain('completion_session_id')
    expect('prompt_token_ids' in bundle).toBe(false)
    expect('response_logprobs' in bundle).toBe(false)
    expect('polar' in bundle).toBe(false)
  })

  test('redacts credentials, authorization headers, and local filesystem paths', () => {
    const text =
      'Authorization: Bearer tp-c1lsw1yiqks5p2odvaupv644beu51f8fptlat59bup0ttsem in D:\\hl-agent4\\HL-agent3 and /home/yini/private'

    const redacted = redactText(text)

    expect(redacted).not.toContain('tp-c1lsw1yiqks5p2odvaupv644beu51f8fptlat59bup0ttsem')
    expect(redacted).not.toContain('D:\\hl-agent4')
    expect(redacted).not.toContain('/home/yini')
    expect(redacted).toContain('[REDACTED_BEARER_TOKEN]')
    expect(redacted).toContain('$WORKDIR')
    expect(redacted).toContain('$HOME_ALIAS')
  })

  test('redacts nested values while preserving structure', () => {
    const redacted = redactValue({
      headers: {
        Authorization: 'Bearer sk-1234567890abcdefghijklmnopqrstuv',
        xCustom: 'safe',
      },
      cwd: 'C:\\Users\\yini\\project',
      nested: ['ANTHROPIC_AUTH_TOKEN=tp-c1abcdefghijklmnopqrstuvwxyz012345'],
    })

    expect(redacted).toEqual({
      headers: {
        Authorization: '[REDACTED_AUTH_HEADER]',
        xCustom: 'safe',
      },
      cwd: '$HOME_ALIAS\\project',
      nested: ['ANTHROPIC_AUTH_TOKEN=[REDACTED_SECRET]'],
    })
  })

  test('builds a redacted rollout bundle from conversation messages', () => {
    const messages = [
      {
        type: 'user',
        uuid: '00000000-0000-4000-8000-000000000001',
        timestamp: '2026-06-03T00:00:00.000Z',
        message: {
          id: '00000000-0000-4000-8000-000000000101',
          role: 'user',
          content: 'Fix the bug in D:\\hl-agent4\\HL-agent3',
        },
      },
      {
        type: 'assistant',
        uuid: '00000000-0000-4000-8000-000000000002',
        timestamp: '2026-06-03T00:00:01.000Z',
        requestId: 'req_001',
        message: {
          id: '00000000-0000-4000-8000-000000000102',
          container: null,
          model: 'mimo-v2.5',
          role: 'assistant',
          stop_reason: 'tool_use',
          stop_sequence: '',
          type: 'message',
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [
            {
              type: 'tool_use',
              id: 'toolu_001',
              name: 'Bash',
              input: {
                command:
                  'echo ANTHROPIC_AUTH_TOKEN=tp-c1abcdefghijklmnopqrstuvwxyz012345',
              },
            },
          ],
          context_management: null,
        },
        isApiErrorMessage: false,
      },
      {
        type: 'user',
        uuid: '00000000-0000-4000-8000-000000000003',
        timestamp: '2026-06-03T00:00:02.000Z',
        message: {
          id: '00000000-0000-4000-8000-000000000103',
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_001',
              content: 'completed in C:\\Users\\yini\\project',
            },
          ],
        },
      },
    ] as unknown as Message[]

    const bundle = buildConversationRolloutBundle({
      messages,
      runId: 'run_002',
      sessionId: 'session_002',
      taskId: 'task_002',
      source: 'internal',
      split: 'train',
      timestamp: '2026-06-03T00:00:03.000Z',
      harnessVersion: 'git:def456',
      heuristicBundleVersion: 'hb:initial',
      policyVersion: 'mimo-v2.5',
      repo: 'leviathan',
      baseCommit: 'def456',
      cwdAlias: '$WORKDIR',
    })

    expect(bundle.task.user_instruction).toBe('Fix the bug in $WORKDIR')
    expect(bundle.messages).toHaveLength(3)
    expect(bundle.messages[1]).toMatchObject({
      role: 'assistant',
      model: 'mimo-v2.5',
      request_id: 'req_001',
    })
    expect(JSON.stringify(bundle.messages)).not.toContain(
      'tp-c1abcdefghijklmnopqrstuvwxyz012345',
    )
    expect(bundle.tool_events).toEqual([
      {
        tool_use_id: 'toolu_001',
        tool_name: 'Bash',
        input_redacted: {
          command: 'echo ANTHROPIC_AUTH_TOKEN=[REDACTED_SECRET]',
        },
        success: true,
        result_summary: 'completed in $HOME_ALIAS\\project',
      },
    ])
    expect(bundle.security.export_allowed).toBe(false)
    expect('response_logprobs' in bundle).toBe(false)
  })
})
