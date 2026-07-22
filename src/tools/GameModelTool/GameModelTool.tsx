import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { resolve } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  evaluateGameDatasetBenchmark,
  type GameBenchmarkEvaluation,
} from '../../game/benchmark.js'
import {
  gameRoiRegionSchema,
  loadGameCalibration,
  saveGameCalibration,
  type GameCalibrationManifest,
} from '../../game/calibration.js'
import {
  buildGameDataset,
  gameFrameLabelsSchema,
  getGameDatasetSample,
  resolveGameDatasetPath,
  saveGameAnnotation,
  type GameDatasetManifest,
  type GameDatasetSample,
  type GameFrameAnnotation,
} from '../../game/dataset.js'
import { evaluateGameReplay } from '../../game/replayEvaluator.js'
import { findGameWindow, runGameMenuFlow } from '../../game/menuAutomation.js'
import {
  ensureGameProfile,
  getDefaultGameProfilePath,
  loadGameProfile,
  saveGameCaptureConfig,
  saveGameMenuFlow,
} from '../../game/profile.js'
import {
  getGameSessionSummary,
  pauseGameSession,
  resumeGameSession,
  setGameSessionGoal,
  startGameSession,
  stopGameSession,
} from '../../game/runtimeManager.js'
import type {
  GameMenuAction,
  GameModelMode,
  GameProfile,
  GameReplayEvaluation,
  GameRuntimeSummary,
} from '../../game/types.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { parseDataUri } from '../BashTool/utils.js'
import {
  runWindowsComputerUse,
  type ComputerUseScreenshot,
  type ComputerUseWindow,
} from '../ComputerUseTool/windowsComputerUse.js'
import {
  GAME_MODEL_ACTIONS,
  GAME_MODEL_TOOL_NAME,
  type GameModelAction,
} from './constants.js'
import { getPrompt } from './prompt.js'
import {
  actionLabel,
  getGameModelToolSummary,
  renderToolResultMessage,
  renderToolUseMessage,
} from './UI.js'

const menuActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.enum(['click', 'double_click']),
    xRatio: z.number().min(0).max(1),
    yRatio: z.number().min(0).max(1),
    delayAfterMs: z.number().int().min(0).max(30_000).optional(),
  }),
  z.strictObject({
    type: z.literal('press_key'),
    key: z.string().min(1).max(80),
    delayAfterMs: z.number().int().min(0).max(30_000).optional(),
  }),
  z.strictObject({
    type: z.literal('wait'),
    durationMs: z.number().int().min(0).max(30_000),
  }),
])

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(GAME_MODEL_ACTIONS),
    objective: z.string().max(4000).optional(),
    profile_path: z.string().optional(),
    capture_backend: z
      .enum([
        'windows_graphics_capture',
        'windows_gdi_fallback',
        'external_native',
      ])
      .optional(),
    capture_fps: z.number().int().min(1).max(120).optional(),
    record_frames: z.boolean().optional(),
    dataset_sample_fps: z.number().int().min(0).max(30).optional(),
    hwnd: z.string().optional(),
    calibration_path: z.string().optional(),
    roi_regions: z.array(gameRoiRegionSchema).min(1).max(64).optional(),
    flow_name: z.string().optional(),
    menu_actions: z.array(menuActionSchema).max(40).optional(),
    replay_path: z.string().optional(),
    session_path: z.string().optional(),
    dataset_path: z.string().optional(),
    sample_id: z.string().optional(),
    max_samples: z.number().int().min(1).max(100_000).optional(),
    minimum_motion_score: z.number().min(0).max(1).optional(),
    include_black_frames: z.boolean().optional(),
    annotation_status: z.enum(['annotated', 'reviewed', 'rejected']).optional(),
    annotation_source: z.enum(['manual', 'model', 'imported']).optional(),
    labels: gameFrameLabelsSchema.optional(),
    predictions_path: z.string().optional(),
    baseline_report_path: z.string().optional(),
    report_path: z.string().optional(),
    include_screenshot: z.boolean().optional(),
  }),
)

const screenshotSchema = z.object({
  dataUrl: z.string(),
  mediaType: z.literal('image/png'),
  width: z.number(),
  height: z.number(),
  originalWidth: z.number(),
  originalHeight: z.number(),
  originX: z.number(),
  originY: z.number(),
  scale: z.number(),
  coordinateSpace: z.literal('screenshot'),
  hwnd: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    ok: z.boolean(),
    action: z.enum(GAME_MODEL_ACTIONS),
    message: z.string(),
    mode: z.enum(['off', 'observe', 'demo', 'live']).optional(),
    profile_path: z.string().optional(),
    profile: z.unknown().optional(),
    summary: z.unknown().optional(),
    menu_flow: z
      .object({
        name: z.string(),
        hwnd: z.string(),
        actionCount: z.number(),
      })
      .optional(),
    window: z
      .object({
        hwnd: z.string(),
        title: z.string(),
        processName: z.string(),
        processId: z.number(),
        bounds: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
        blockedReason: z.string().optional(),
      })
      .optional(),
    evaluation: z.unknown().optional(),
    calibration: z.unknown().optional(),
    dataset: z.unknown().optional(),
    dataset_path: z.string().optional(),
    sample: z.unknown().optional(),
    annotation: z.unknown().optional(),
    benchmark: z.unknown().optional(),
    report_path: z.string().optional(),
    screenshot: screenshotSchema.optional(),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type OutputSchema = ReturnType<typeof outputSchema>

export type GameModelToolInput = z.infer<InputSchema>
export type GameModelToolOutput = {
  ok: boolean
  action: GameModelAction
  message: string
  mode?: GameModelMode
  profile_path?: string
  profile?: GameProfile
  summary?: GameRuntimeSummary
  menu_flow?: { name: string; hwnd: string; actionCount: number }
  window?: ComputerUseWindow
  evaluation?: GameReplayEvaluation
  calibration?: GameCalibrationManifest
  dataset?: GameDatasetManifest
  dataset_path?: string
  sample?: GameDatasetSample
  annotation?: GameFrameAnnotation
  benchmark?: GameBenchmarkEvaluation
  report_path?: string
  screenshot?: ComputerUseScreenshot
}

function permissionRuleContent(action: GameModelAction): string {
  return `action:${action}`
}

function isReadOnly(input: GameModelToolInput): boolean {
  return (
    input.action === 'get_profile' ||
    input.action === 'get_calibration' ||
    input.action === 'discover_window' ||
    input.action === 'get_summary' ||
    input.action === 'get_annotation_sample' ||
    (input.action === 'evaluate_replay' && !input.report_path) ||
    (input.action === 'evaluate_detector_benchmark' && !input.report_path) ||
    input.action === 'pause' ||
    input.action === 'stop_session'
  )
}

export const GameModelTool = buildTool({
  name: GAME_MODEL_TOOL_NAME,
  searchHint:
    'realtime game agent sessions, temporal state, replay evaluation, and calibrated game menu flows',
  shouldDefer: true,
  maxResultSizeChars: 60_000,
  async description(input) {
    const action = (input as Partial<GameModelToolInput>).action
    return action
      ? `Leviathan wants to use GameModel: ${actionLabel(action)}`
      : 'Leviathan wants to use GameModel'
  },
  userFacingName() {
    return 'GameModel'
  },
  getToolUseSummary: getGameModelToolSummary,
  getActivityDescription(input) {
    return `GameModel: ${getGameModelToolSummary(input as Partial<GameModelToolInput>) ?? 'runtime action'}`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return process.platform === 'win32'
  },
  isReadOnly(input) {
    return isReadOnly(input as GameModelToolInput)
  },
  toAutoClassifierInput(input) {
    return `${input.action}${input.hwnd ? ` hwnd=${input.hwnd}` : ''}`
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const action = input.action
    const permissionContext = context.getAppState().toolPermissionContext
    if (action === 'pause' || action === 'stop_session') {
      return { behavior: 'allow', updatedInput: input }
    }
    if (permissionContext.mode === 'bypassPermissions') {
      return { behavior: 'allow', updatedInput: input }
    }
    if (isReadOnly(input)) return { behavior: 'allow', updatedInput: input }
    const ruleContent = permissionRuleContent(action)
    const denyRule = getRuleByContentsForTool(
      permissionContext,
      GameModelTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${GAME_MODEL_TOOL_NAME} denied ${ruleContent}.`,
        decisionReason: { type: 'rule', rule: denyRule },
      }
    }
    const allowRule = getRuleByContentsForTool(
      permissionContext,
      GameModelTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'rule', rule: allowRule },
      }
    }
    return {
      behavior: 'ask',
      message: `Leviathan requested GameModel action ${action}.`,
      updatedInput: input,
      suggestions: [
        {
          type: 'addRules',
          destination: 'session',
          rules: [{ toolName: GAME_MODEL_TOOL_NAME, ruleContent }],
          behavior: 'allow',
        },
      ],
    }
  },
  async validateInput(input) {
    switch (input.action) {
      case 'set_goal':
        if (!input.objective?.trim()) {
          return {
            result: false as const,
            message: `${input.action} requires objective.`,
            errorCode: 1,
          }
        }
        break
      case 'save_menu_flow':
        if (!input.flow_name || !input.menu_actions?.length) {
          return {
            result: false as const,
            message: 'save_menu_flow requires flow_name and menu_actions.',
            errorCode: 2,
          }
        }
        break
      case 'configure_capture':
        if (
          input.capture_backend === undefined &&
          input.capture_fps === undefined &&
          input.record_frames === undefined &&
          input.dataset_sample_fps === undefined
        ) {
          return {
            result: false as const,
            message:
              'configure_capture requires capture_backend, capture_fps, record_frames, or dataset_sample_fps.',
            errorCode: 5,
          }
        }
        break
      case 'save_calibration':
        if (!input.roi_regions?.length) {
          return {
            result: false as const,
            message:
              'save_calibration requires roi_regions measured from a real screenshot.',
            errorCode: 6,
          }
        }
        break
      case 'build_dataset':
        if (!input.session_path) {
          return {
            result: false as const,
            message: 'build_dataset requires session_path.',
            errorCode: 7,
          }
        }
        break
      case 'get_annotation_sample':
        if (!input.dataset_path) {
          return {
            result: false as const,
            message: 'get_annotation_sample requires dataset_path.',
            errorCode: 8,
          }
        }
        break
      case 'save_annotation':
        if (
          !input.dataset_path ||
          !input.sample_id ||
          !input.annotation_status ||
          !input.annotation_source
        ) {
          return {
            result: false as const,
            message:
              'save_annotation requires dataset_path, sample_id, annotation_status, and annotation_source.',
            errorCode: 9,
          }
        }
        if (input.annotation_status !== 'rejected' && !input.labels) {
          return {
            result: false as const,
            message: 'Annotated and reviewed samples require labels.',
            errorCode: 10,
          }
        }
        break
      case 'evaluate_detector_benchmark':
        if (!input.dataset_path || !input.predictions_path) {
          return {
            result: false as const,
            message:
              'evaluate_detector_benchmark requires dataset_path and predictions_path.',
            errorCode: 11,
          }
        }
        break
      case 'run_menu_flow':
        if (!input.flow_name) {
          return {
            result: false as const,
            message: 'run_menu_flow requires flow_name.',
            errorCode: 3,
          }
        }
        break
      case 'evaluate_replay':
        if (!input.replay_path) {
          return {
            result: false as const,
            message: 'evaluate_replay requires replay_path.',
            errorCode: 4,
          }
        }
        break
    }
    return { result: true as const }
  },
  async prompt() {
    return getPrompt()
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input, context) {
    const cwd = getCwd()
    const mode = context.getAppState().gameModelMode
    if (mode === 'off') {
      throw new Error(
        'GameModel is disabled. The user must run /gamemodel first.',
      )
    }

    let output: GameModelToolOutput
    switch (input.action) {
      case 'initialize_profile': {
        const result = await ensureGameProfile(cwd, input.profile_path)
        output = {
          ok: true,
          action: input.action,
          mode,
          message: result.created
            ? 'Created the GameModel profile. Menu flows are intentionally empty until calibrated from the real game UI.'
            : 'GameModel profile already exists.',
          profile_path: result.path,
          profile: result.profile,
        }
        break
      }
      case 'get_profile': {
        const profilePath = input.profile_path
          ? resolve(cwd, input.profile_path)
          : getDefaultGameProfilePath(cwd)
        const profile = await loadGameProfile(cwd, profilePath)
        output = {
          ok: true,
          action: input.action,
          mode,
          message: 'Loaded the GameModel profile.',
          profile_path: profilePath,
          profile,
        }
        break
      }
      case 'configure_capture': {
        const result = await saveGameCaptureConfig({
          cwd,
          profilePath: input.profile_path,
          backend: input.capture_backend,
          fps: input.capture_fps,
          recordFrames: input.record_frames,
          datasetSampleFps: input.dataset_sample_fps,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message: `Configured ${result.profile.capture.backend} at ${result.profile.capture.fps} FPS; recording is ${result.profile.capture.recordFrames ? 'enabled' : 'disabled'} and annotation sampling is ${result.profile.capture.datasetSampleFps} FPS.`,
          profile_path: result.path,
          profile: result.profile,
        }
        break
      }
      case 'get_calibration': {
        const ensured = await ensureGameProfile(cwd, input.profile_path)
        const result = await loadGameCalibration({
          cwd,
          profileId: ensured.profile.id,
          calibrationPath: input.calibration_path,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message: `Loaded ROI calibration ${result.calibration.calibrationId} revision ${result.calibration.revision}.`,
          profile_path: ensured.path,
          calibration: result.calibration,
        }
        break
      }
      case 'save_calibration': {
        const ensured = await ensureGameProfile(cwd, input.profile_path)
        const window = await findGameWindow(
          ensured.profile,
          input.hwnd,
          context.abortController.signal,
        )
        const captured = await runWindowsComputerUse(
          { action: 'screenshot', hwnd: window.hwnd },
          context.abortController.signal,
        )
        const screenshot = captured.screenshot
        if (!screenshot)
          throw new Error('Calibration capture returned no screenshot.')
        const parsed = parseDataUri(screenshot.dataUrl)
        if (!parsed || parsed.mediaType !== 'image/png') {
          throw new Error('Calibration capture did not return a PNG image.')
        }
        const result = await saveGameCalibration({
          cwd,
          profileId: ensured.profile.id,
          calibrationPath: input.calibration_path,
          referenceImage: Buffer.from(parsed.data, 'base64'),
          windowViewport: {
            width: screenshot.originalWidth,
            height: screenshot.originalHeight,
          },
          regions: input.roi_regions!,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message: `Saved ${result.calibration.regions.length} normalized ROIs as calibration ${result.calibration.calibrationId} revision ${result.calibration.revision}.`,
          profile_path: ensured.path,
          calibration: result.calibration,
          screenshot,
        }
        break
      }
      case 'discover_window': {
        const ensured = await ensureGameProfile(cwd, input.profile_path)
        const window = await findGameWindow(
          ensured.profile,
          input.hwnd,
          context.abortController.signal,
        )
        const captured = await runWindowsComputerUse(
          {
            action: 'get_window_state',
            hwnd: window.hwnd,
            include_screenshot: input.include_screenshot ?? true,
            include_text: false,
          },
          context.abortController.signal,
        )
        output = {
          ok: true,
          action: input.action,
          mode,
          message:
            'Found a visible game window that matches the active profile.',
          profile_path: ensured.path,
          window,
          screenshot: captured.state?.screenshots[0],
        }
        break
      }
      case 'save_menu_flow': {
        const result = await saveGameMenuFlow({
          cwd,
          profilePath: input.profile_path,
          flowName: input.flow_name!,
          actions: input.menu_actions as GameMenuAction[],
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message: `Saved calibrated menu flow ${input.flow_name}.`,
          profile_path: result.path,
          profile: result.profile,
        }
        break
      }
      case 'run_menu_flow': {
        requireLiveMode(mode, input.action)
        const ensured = await ensureGameProfile(cwd, input.profile_path)
        const result = await runGameMenuFlow({
          profile: ensured.profile,
          flowName: input.flow_name!,
          hwnd: input.hwnd,
          signal: context.abortController.signal,
        })
        output = {
          ok: result.output.ok,
          action: input.action,
          mode,
          message: result.output.message,
          profile_path: ensured.path,
          menu_flow: {
            name: result.flowName,
            hwnd: result.hwnd,
            actionCount: result.actionCount,
          },
          screenshot:
            result.output.screenshot ?? result.output.state?.screenshots[0],
        }
        break
      }
      case 'start_session': {
        const objective =
          input.objective?.trim() ||
          (mode === 'observe'
            ? 'Collect a trusted observation trace for calibration and offline evaluation.'
            : mode === 'demo'
              ? 'Collect a synchronized human gameplay demonstration for action-conditioned world-model training.'
            : undefined)
        if (!objective) {
          throw new Error(
            'Live GameModel sessions require an explicit objective.',
          )
        }
        const ensured = await ensureGameProfile(cwd, input.profile_path)
        const discoveredHwnd = input.hwnd
          ? input.hwnd
          : await findGameWindow(
              ensured.profile,
              undefined,
              context.abortController.signal,
            )
              .then((window) => window.hwnd)
              .catch((error) => {
                if (mode === 'live' || mode === 'demo') throw error
                return undefined
              })
        const sessionProfile =
          mode === 'demo'
            ? {
                ...ensured.profile,
                capture: {
                  ...ensured.profile.capture,
                  recordFrames: true,
                  datasetSampleFps: Math.max(
                    10,
                    ensured.profile.capture.datasetSampleFps,
                  ),
                },
              }
            : ensured.profile
        const summary = await startGameSession({
          cwd,
          controlMode: mode,
          objective,
          profile: sessionProfile,
          profilePath: ensured.path,
          hwnd: discoveredHwnd,
          signal: context.abortController.signal,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message:
            mode === 'demo'
              ? `Started demo GameModel session with ${sessionProfile.capture.datasetSampleFps} FPS aligned frame sampling and foreground-only human input recording.`
              : `Started ${mode} GameModel session.`,
          profile_path: ensured.path,
          summary,
        }
        break
      }
      case 'set_goal':
        output = summaryOutput(
          input.action,
          mode,
          'Updated the GameModel objective.',
          await setGameSessionGoal(
            input.objective!,
            context.abortController.signal,
          ),
        )
        break
      case 'get_summary': {
        const summary = await getGameSessionSummary(
          context.abortController.signal,
        )
        if (!summary) throw new Error('No GameModel session has been started.')
        let screenshot: ComputerUseScreenshot | undefined
        if (input.include_screenshot && summary.hwnd) {
          const captured = await runWindowsComputerUse(
            { action: 'screenshot', hwnd: summary.hwnd },
            context.abortController.signal,
          )
          screenshot = captured.screenshot
        }
        output = {
          ...summaryOutput(
            input.action,
            mode,
            'Read the current GameModel belief state.',
            summary,
          ),
          screenshot,
        }
        break
      }
      case 'pause':
        output = summaryOutput(
          input.action,
          mode,
          'Paused GameModel and released all input.',
          await pauseGameSession(context.abortController.signal),
        )
        break
      case 'resume':
        output = summaryOutput(
          input.action,
          mode,
          'Resumed GameModel.',
          await resumeGameSession(context.abortController.signal),
        )
        break
      case 'stop_session': {
        const summary = await stopGameSession(context.abortController.signal)
        if (!summary) throw new Error('No GameModel session has been started.')
        output = summaryOutput(
          input.action,
          mode,
          'Stopped GameModel and released all input.',
          summary,
        )
        break
      }
      case 'evaluate_replay': {
        const ensured = await ensureGameProfile(cwd, input.profile_path)
        const reportPath = input.report_path
          ? resolve(cwd, input.report_path)
          : undefined
        const result = await evaluateGameReplay({
          replayPath: resolve(cwd, input.replay_path!),
          profile: ensured.profile,
          reportPath,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message:
            'Evaluated the replay through the deterministic GameModel state and policy pipeline.',
          profile_path: ensured.path,
          evaluation: result.evaluation,
          report_path: result.reportPath,
        }
        break
      }
      case 'build_dataset': {
        const ensured = await ensureGameProfile(cwd, input.profile_path)
        const result = await buildGameDataset({
          cwd,
          sessionPath: input.session_path!,
          profileId: ensured.profile.id,
          calibrationPath: input.calibration_path,
          outputPath: input.dataset_path,
          maxSamples: input.max_samples,
          minimumMotionScore: input.minimum_motion_score,
          includeBlackFrames: input.include_black_frames,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message: `Built deterministic dataset ${result.manifest.datasetId} with ${result.manifest.sampleCount} integrity-checked samples.`,
          profile_path: ensured.path,
          dataset: result.manifest,
          dataset_path: result.datasetPath,
        }
        break
      }
      case 'get_annotation_sample': {
        const datasetPath = resolveGameDatasetPath(cwd, input.dataset_path!)
        const result = await getGameDatasetSample({
          datasetPath,
          sampleId: input.sample_id,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message: `Loaded ${result.sample.sampleId} (${result.annotation.status}, revision ${result.annotation.revision}) for visual annotation.`,
          dataset_path: datasetPath,
          sample: result.sample,
          annotation: result.annotation,
          screenshot: {
            dataUrl: `data:image/png;base64,${result.image.toString('base64')}`,
            mediaType: 'image/png',
            width: result.sample.imageWidth,
            height: result.sample.imageHeight,
            originalWidth: result.sample.imageWidth,
            originalHeight: result.sample.imageHeight,
            originX: 0,
            originY: 0,
            scale: 1,
            coordinateSpace: 'screenshot',
          },
        }
        break
      }
      case 'save_annotation': {
        const datasetPath = resolveGameDatasetPath(cwd, input.dataset_path!)
        const result = await saveGameAnnotation({
          datasetPath,
          sampleId: input.sample_id!,
          status: input.annotation_status!,
          source: input.annotation_source!,
          labels: input.labels,
        })
        output = {
          ok: true,
          action: input.action,
          mode,
          message: `Saved ${result.annotation.status} annotation for ${result.annotation.sampleId} at revision ${result.annotation.revision}.`,
          dataset_path: datasetPath,
          dataset: result.manifest,
          annotation: result.annotation,
        }
        break
      }
      case 'evaluate_detector_benchmark': {
        const result = await evaluateGameDatasetBenchmark({
          cwd,
          datasetPath: input.dataset_path!,
          predictionsPath: input.predictions_path!,
          reportPath: input.report_path,
          baselineReportPath: input.baseline_report_path,
        })
        output = {
          ok: result.evaluation.sampleCounts.imageIntegrityFailures === 0,
          action: input.action,
          mode,
          message: `Evaluated detector ${result.evaluation.detectorId} on ${result.evaluation.sampleCounts.eligible} labeled samples with ${(result.evaluation.coverage * 100).toFixed(1)}% prediction coverage.`,
          dataset_path: result.evaluation.datasetPath,
          benchmark: result.evaluation,
          report_path: result.reportPath,
        }
        break
      }
    }
    return { data: output }
  },
  mapToolResultToToolResultBlockParam(
    output: GameModelToolOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    const safeOutput = output.screenshot
      ? {
          ...output,
          screenshot: { ...output.screenshot, dataUrl: '[image attached]' },
        }
      : output
    const parsed = output.screenshot
      ? parseDataUri(output.screenshot.dataUrl)
      : null
    if (!parsed) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: JSON.stringify(safeOutput, null, 2),
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        { type: 'text', text: JSON.stringify(safeOutput, null, 2) },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: parsed.mediaType as 'image/png',
            data: parsed.data,
          },
        },
      ],
    }
  },
} satisfies ToolDef<InputSchema, z.infer<OutputSchema>>)

function requireLiveMode(mode: GameModelMode, action: GameModelAction): void {
  if (mode !== 'live') {
    throw new Error(`${action} requires /gamemodel live.`)
  }
}

function summaryOutput(
  action: GameModelAction,
  mode: GameModelMode,
  message: string,
  summary: GameRuntimeSummary,
): GameModelToolOutput {
  return { ok: true, action, mode, message, summary }
}
