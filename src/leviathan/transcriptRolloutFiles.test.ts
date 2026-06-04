import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeTranscriptRolloutFile } from '../learning/transcriptRolloutFiles.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-transcript-rollout-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writeMinimalTranscript(path: string, sessionId: string): void {
  const userUuid = '00000000-0000-4000-8000-000000000401'
  const assistantUuid = '00000000-0000-4000-8000-000000000402'
  const lines = [
    {
      type: 'user',
      uuid: userUuid,
      parentUuid: null,
      sessionId,
      timestamp: '2026-06-04T00:00:00.000Z',
      message: {
        role: 'user',
        content: 'Fix a real Leviathan bug in the local workspace',
      },
    },
    {
      type: 'assistant',
      uuid: assistantUuid,
      parentUuid: userUuid,
      sessionId,
      timestamp: '2026-06-04T00:00:01.000Z',
      requestId: 'req_transcript_rollout_001',
      message: {
        id: 'msg_transcript_rollout_001',
        type: 'message',
        role: 'assistant',
        model: 'mimo-v2.5',
        content: [{ type: 'text', text: 'Done.' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 3 },
        container: null,
        context_management: null,
      },
      isApiErrorMessage: false,
    },
  ]
  writeFileSync(path, lines.map(line => JSON.stringify(line)).join('\n'), 'utf8')
}

describe('Leviathan transcript rollout files', () => {
  test('exports a persisted headless transcript into a rollout bundle with provenance', async () => {
    await withTempDir(async dir => {
      const sessionId = '00000000-0000-4000-8000-000000000401'
      const transcriptPath = join(dir, `${sessionId}.jsonl`)
      const outputPath = join(dir, 'rollout.json')
      writeMinimalTranscript(transcriptPath, sessionId)

      const result = await writeTranscriptRolloutFile({
        transcript_path: transcriptPath,
        output_path: outputPath,
        run_id: 'train_shadow_001',
        task_id: 'train_shadow_001_train_001',
        split: 'train',
        provider_model_id: 'mimo-v2.5',
        harness_version: 'git:abc123',
        heuristic_bundle_version: 'hb:unversioned',
        repo: 'leviathan',
        base_commit: 'abc123',
        cwd_alias: '$WORKDIR',
      })

      expect(result.output_path).toBe(outputPath)
      expect(existsSync(outputPath)).toBe(true)
      const exported = JSON.parse(readFileSync(outputPath, 'utf8'))
      expect(exported.schema_version).toBe('leviathan.rollout.v1')
      expect(exported.run).toMatchObject({
        run_id: 'train_shadow_001',
        session_id: sessionId,
        task_id: 'train_shadow_001_train_001',
        split: 'train',
        policy_version: 'mimo-v2.5',
        harness_version: 'git:abc123',
      })
      expect(exported.task.user_instruction).toBe(
        'Fix a real Leviathan bug in the local workspace',
      )
      expect(exported.messages).toHaveLength(2)
      expect(exported.tool_events).toEqual([])
      expect(exported.security.export_allowed).toBe(false)
    })
  })
})
