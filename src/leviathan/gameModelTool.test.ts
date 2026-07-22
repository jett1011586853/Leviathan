import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { getTools } from '../tools.js'
import { GameModelTool } from '../tools/GameModelTool/GameModelTool.js'
import {
  GAME_MODEL_ACTIONS,
  GAME_MODEL_TOOL_NAME,
} from '../tools/GameModelTool/constants.js'

function contextWithMode(mode: 'default' | 'bypassPermissions') {
  return {
    getAppState: () => ({
      gameModelMode: 'observe',
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
        isBypassPermissionsModeAvailable: true,
      },
    }),
  } as ToolUseContext
}

describe('Leviathan GameModel tool', () => {
  test('is hidden until the GameModel feature gate is enabled', () => {
    expect(
      getTools(getEmptyToolPermissionContext()).some(
        (tool) => tool.name === GAME_MODEL_TOOL_NAME,
      ),
    ).toBe(false)
    expect(
      getTools(getEmptyToolPermissionContext(), {
        includeGameModelTools: true,
      }).some((tool) => tool.name === GAME_MODEL_TOOL_NAME),
    ).toBe(process.platform === 'win32')
  })

  test('keeps stop and pause always available while gating mutations', async () => {
    const startDecision = await GameModelTool.checkPermissions(
      { action: 'start_session', objective: 'observe' },
      contextWithMode('default'),
    )
    expect(startDecision.behavior).toBe('ask')

    const stopDecision = await GameModelTool.checkPermissions(
      { action: 'stop_session' },
      contextWithMode('default'),
    )
    expect(stopDecision.behavior).toBe('allow')

    const bypassDecision = await GameModelTool.checkPermissions(
      { action: 'save_menu_flow', flow_name: 'test', menu_actions: [] },
      contextWithMode('bypassPermissions'),
    )
    expect(bypassDecision.behavior).toBe('allow')
  })

  test('validates the coarse runtime contract', async () => {
    const missingObjective = await GameModelTool.validateInput({
      action: 'start_session',
    })
    expect(missingObjective.result).toBe(true)
    expect(
      (await GameModelTool.validateInput({ action: 'set_goal' })).result,
    ).toBe(false)
    expect(GAME_MODEL_ACTIONS).not.toContain('ingest_observation')
    expect(
      GameModelTool.inputSchema.safeParse({
        action: 'ingest_observation',
        observation: { health: 100 },
      }).success,
    ).toBe(false)
    expect(
      GameModelTool.inputSchema.safeParse({
        action: 'configure_capture',
        capture_backend: 'windows_graphics_capture',
        capture_fps: 60,
        record_frames: true,
        dataset_sample_fps: 2,
      }).success,
    ).toBe(true)
    expect(
      (await GameModelTool.validateInput({ action: 'configure_capture' }))
        .result,
    ).toBe(false)
    expect(
      GameModelTool.inputSchema.safeParse({
        action: 'save_calibration',
        roi_regions: [
          {
            id: 'combat',
            kind: 'combat_view',
            rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      (
        await GameModelTool.validateInput({
          action: 'evaluate_detector_benchmark',
          dataset_path: 'dataset',
        })
      ).result,
    ).toBe(false)
  })

  test('documents the realtime boundary and stale-input fail-safe', async () => {
    const prompt = await GameModelTool.prompt()
    expect(prompt).toContain('temporal world state')
    expect(prompt).toContain('model cannot submit')
    expect(prompt).toContain('capability')
    expect(prompt).toContain('releases all input')
    expect(prompt).toContain('has no capability to submit phase, HUD')
    expect(prompt).toContain('frames.index.jsonl')
    expect(prompt).toContain('IoU@0.5')
  })
})
