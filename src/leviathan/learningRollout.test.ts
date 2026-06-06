import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  OPTIONAL_ROLLOUT_FIELDS,
  POLAR_ONLY_ROLLOUT_FIELDS,
  ROLLOUT_SCHEMA_VERSION,
  createEmptyRolloutBundle,
} from '../learning/rolloutSchema.js'
import {
  buildRolloutExportContent,
  call as exportCall,
  parseExportArgs,
} from '../commands/export/export.js'
import { buildConversationRolloutBundle } from '../learning/conversationRollout.js'
import { redactText, redactValue } from '../learning/redaction.js'
import type { Message } from '../types/message.js'
import { runWithCwdOverride } from '../utils/cwd.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-rollout-export-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

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
      'Authorization: Bearer local-redaction-token in D:\\hl-agent4\\HL-agent3, D:/hl-agent4/HL-agent3, /home/yini/private, and ANTHROPIC_BASE_URL=https://token-plan-cn.example.com/anthropic'

    const redacted = redactText(text)

    expect(redacted).not.toContain('local-redaction-token')
    expect(redacted).not.toContain('D:\\hl-agent4')
    expect(redacted).not.toContain('D:/hl-agent4')
    expect(redacted).not.toContain('/home/yini')
    expect(redacted).not.toContain('token-plan-cn.example.com')
    expect(redacted).toContain('[REDACTED_BEARER_TOKEN]')
    expect(redacted).toContain('ANTHROPIC_BASE_URL=[REDACTED_PROVIDER_URL]')
    expect(redacted).toContain('$WORKDIR')
    expect(redacted).toContain('$HOME_ALIAS')
  })

  test('redacts nested values while preserving structure', () => {
    const redacted = redactValue({
      headers: {
        Authorization: 'Bearer local-redaction-token',
        xCustom: 'safe',
      },
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      provider: {
        base_url: 'https://token-plan-cn.example.com/anthropic',
      },
      cwd: 'C:\\Users\\yini\\project',
      nested: ['ANTHROPIC_AUTH_TOKEN=local-redaction-token'],
    })

    expect(redacted).toEqual({
      headers: {
        Authorization: '[REDACTED_AUTH_HEADER]',
        xCustom: 'safe',
      },
      ANTHROPIC_BASE_URL: '[REDACTED_PROVIDER_URL]',
      provider: {
        base_url: '[REDACTED_PROVIDER_URL]',
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
                  'echo ANTHROPIC_AUTH_TOKEN=local-redaction-token',
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
      'local-redaction-token',
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

  test('parses rollout export mode without changing normal export filenames', () => {
    expect(parseExportArgs('--rollout training-run.json')).toEqual({
      mode: 'rollout',
      filename: 'training-run.json',
      overrides: {},
    })
    expect(parseExportArgs('conversation-name')).toEqual({
      mode: 'conversation',
      filename: 'conversation-name',
      overrides: {},
    })
  })

  test('parses rollout export metadata flags for shadow task provenance', () => {
    expect(
      parseExportArgs(
        '--rollout shadow-rollout.json --run-id train_shadow_001 --task-id train_shadow_001_train_001 --split train --harness-version git:abc123 --heuristic-bundle hb:initial --policy-version mimo-v2.5 --base-commit abc123 --repo leviathan',
      ),
    ).toEqual({
      mode: 'rollout',
      filename: 'shadow-rollout.json',
      overrides: {
        runId: 'train_shadow_001',
        taskId: 'train_shadow_001_train_001',
        split: 'train',
        harnessVersion: 'git:abc123',
        heuristicBundleVersion: 'hb:initial',
        policyVersion: 'mimo-v2.5',
        baseCommit: 'abc123',
        repo: 'leviathan',
      },
    })
  })

  test('writes rollout export metadata flags into the bundle', async () => {
    await withTempDir(async dir => {
      const outputName = 'shadow-rollout.json'
      let doneMessage = ''
      const messages = [
        {
          type: 'user',
          uuid: '00000000-0000-4000-8000-000000000204',
          timestamp: '2026-06-04T00:00:00.000Z',
          message: {
            id: '00000000-0000-4000-8000-000000000204',
            role: 'user',
            content: 'Run a real Leviathan task for the train split',
          },
        },
      ] as unknown as Message[]

      await runWithCwdOverride(dir, async () => {
        await exportCall(
          message => {
            doneMessage = message ?? ''
          },
          {
            messages,
            options: {
              mainLoopModel: 'ignored-default-model',
            },
          } as never,
          '--rollout shadow-rollout.json --run-id train_shadow_001 --task-id train_shadow_001_train_001 --split train --harness-version git:abc123 --heuristic-bundle hb:initial --policy-version mimo-v2.5 --base-commit abc123 --repo leviathan',
        )
      })

      const outputPath = join(dir, outputName)
      expect(existsSync(outputPath)).toBe(true)
      const exported = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(exported.run.run_id).toBe('train_shadow_001')
      expect(exported.run.task_id).toBe('train_shadow_001_train_001')
      expect(exported.run.split).toBe('train')
      expect(exported.run.harness_version).toBe('git:abc123')
      expect(exported.run.heuristic_bundle_version).toBe('hb:initial')
      expect(exported.run.policy_version).toBe('mimo-v2.5')
      expect(exported.task.repo).toBe('leviathan')
      expect(exported.task.base_commit).toBe('abc123')
      expect(doneMessage).toContain('Rollout bundle exported')
    })
  })

  test('builds rollout export JSON from command context', async () => {
    const messages = [
      {
        type: 'user',
        uuid: '00000000-0000-4000-8000-000000000004',
        timestamp: '2026-06-03T00:00:00.000Z',
        message: {
          id: '00000000-0000-4000-8000-000000000104',
          role: 'user',
          content:
            'Analyze D:\\hl-agent4\\secret with Authorization: Bearer local-redaction-token',
        },
      },
    ] as unknown as Message[]

    const content = await buildRolloutExportContent(
      {
        messages,
        options: {
          mainLoopModel: 'mimo-v2.5',
        },
      } as never,
      {
        runId: 'run_export',
        sessionId: 'session_export',
        taskId: 'task_export',
        timestamp: '2026-06-03T00:00:01.000Z',
        harnessVersion: 'git:test',
        heuristicBundleVersion: 'hb:initial',
        repo: 'leviathan',
        baseCommit: 'testcommit',
        cwdAlias: '$WORKDIR',
      },
    )
    const parsed = JSON.parse(content)

    expect(parsed.schema_version).toBe(ROLLOUT_SCHEMA_VERSION)
    expect(parsed.run.policy_version).toBe('mimo-v2.5')
    expect(parsed.task.user_instruction).toContain('$WORKDIR')
    expect(content).not.toContain('local-redaction-token')
    expect(content).not.toContain('D:\\hl-agent4')
  })
})
