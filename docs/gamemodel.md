# Leviathan GameModel

## 定位

`GameModel` 是 Leviathan 面向连续游戏场景的实时 AgentModel。Leviathan 主 Agent 负责目标、配置、会话和复盘；独立 Sidecar 负责持续感知、时序状态、战术决策和输入租约。大模型不进入逐帧控制循环。

当前内置 Profile 为 `com.leviathan.game.nzm-future`，对应“逆战：未来”。Profile 中没有虚构地图、怪物、HUD 或通关数据。

```text
Leviathan control plane
  -> GameModel coarse-grained tool
  -> realtime Sidecar
      -> GamePerceptionAdapter
          -> native Windows Graphics Capture process
          -> GDI fallback
      -> trusted observation gate
      -> FrameRingBuffer / WorldState
      -> TacticalPolicy / ControlPlan
      -> foreground lock / input lease / watchdog
```

## 启用方式

```text
/gamemodel observe
/gamemodel status
/gamemodel off
```

- `observe`：采集、状态、决策和回放均运行，但不发送键鼠输入。
- `live`：允许经过前台窗口锁和动作租约保护的输入。只有在感知模型和场景资产通过离线评测后才应使用。
- `off`：停止 Sidecar、原生捕获器和输入桥，释放全部输入状态。

## 原生 Windows 捕获

默认 Profile 使用 `windows_graphics_capture`，目标为 60 FPS。实现位于 `native/game-capture`，使用独立 Rust 进程和 Windows Graphics Capture 获取指定 HWND 的画面。

原生进程通过 NDJSON 只传输帧元数据，不把原始视频帧塞进主 Agent 上下文。Sidecar 使用最多 3 帧的有界队列处理背压；来不及处理时丢弃旧帧而不是无限积压。

每个原生帧真实测量：

- 视口宽高
- 全局运动量
- 4×3 分区运动网格
- 平均亮度与亮度标准差
- 近黑帧概率
- 实测捕获 FPS 与单帧像素处理耗时
- 原始 BGRA 帧 SHA-256

这些字段分别需要 `frame.viewport`、`frame.motion`、`frame.motion_grid` 和 `frame.metrics` 能力。原生捕获器没有 `hud.*`、`navigation.*` 或 `vision.*` 能力，因此不能提交弹药、血量、经济、箭头、怪物或威胁。

如果原生程序缺失、启动失败或目标窗口不支持 WGC，Sidecar 会记录原因并降级到 `windows_gdi_fallback`。GDI 只提供真实视口和全局运动量。

## 录像

将 Profile 的 `recordFrames` 设置为 `true` 后：

- WGC 后端使用系统硬件编码器写入 `capture.mp4`。
- GDI 后端继续写入逐帧 PNG。

可由 GameModel 工具配置：

```json
{
  "action": "configure_capture",
  "capture_backend": "windows_graphics_capture",
  "capture_fps": 60,
  "record_frames": true
}
```

本地构建原生程序：

```powershell
bun run build:game-capture
```

发布工作流会编译并发布 `leviathan-game-capture-windows-x64.exe`。安装器、更新器和启动器会校验哈希并将其安装为 `leviathan-game-capture.exe`。也可通过 `LEVIATHAN_GAME_CAPTURE_BINARY` 指定开发版路径。

## 可信感知边界

主 Agent 没有 observation 注入动作，工具 Schema 和主进程 IPC 均不接受模型构造的游戏状态。每条可信 observation 包含：

- 会话 ID、适配器 ID 和随机实例 ID
- 单调递增的序号与采集时间
- 适配器能力列表
- 帧 SHA-256 与 observation SHA-256
- Sidecar 接收时间

可信门会拒绝错误会话、错误实例、重复序号、过期时间、未来时间、能力越权和尺寸不匹配的运动网格。连续 30 个近黑帧会在 `live` 模式中暂停会话并释放输入。

## 多频率循环

- WGC 捕获目标：60 FPS
- 战术决策默认：10 Hz
- 输入租约维护默认：60 Hz
- 大模型：仅关键事件或用户操作触发

高频帧到达不会导致战术决策同步升到 60 Hz；Sidecar 对决策执行独立限频。感知超过 `observationTimeoutMs` 后立即释放输入。

## 会话产物

```text
.leviathan/gamemodel/sessions/<session-id>/
  session.json
  profile.snapshot.json
  events.jsonl
  observations.jsonl
  capture.mp4              # WGC + recordFrames=true
  frames/*.png             # GDI + recordFrames=true
  frames/*.jpg             # WGC annotation samples
  frames.index.jsonl       # sampled frame provenance and image digests
```

`evaluate_replay` 会重新计算 observation 摘要，将样本分成：

- 可信适配器数据
- 历史未验证数据
- provenance 已损坏或内容被修改的数据

评测只使用回放文件中实际存在的字段，不补造阶段、HUD 或目标。

## 实机验证记录

2026-07-16 在真实“逆战：未来”窗口完成开发冒烟验证：

- 约 3 秒收到 159 个可信 WGC observation
- 稳态捕获约 54.8 FPS，目标 60 FPS
- Sidecar 丢帧 0、黑帧 0
- 战术决策保持约 10 Hz
- 录像经 `ffprobe` 验证为 HEVC、1924×1248、60 FPS、约 2.42 秒

同日又完成约五分钟持续观察：

- 14,961 个可信 observation，拒绝数 0
- 最终实测 52.01 FPS，native ingestion 丢帧 0、黑帧 0
- 写出 565 张 JPEG 数据集采样帧，约 1.82 FPS，符合配置的 2 FPS
- 基于该会话构建 400 样本的确定性 train/validation/test 数据集；标签状态仍为 `unlabeled`

这是单机开发验证，不是跨硬件性能基准，也不代表 HUD、目标识别或自动通关能力。

## 当前真实边界

已实现：

- 原生 WGC 高频窗口捕获与 GDI 自动降级
- 有界队列、生命周期绑定、错误诊断和停止清理
- MP4 录像、真实帧指标和黑帧安全暂停
- 可信来源、能力门控和回放篡改检测
- 时序世界状态、目标轨迹数据结构、战术状态机和输入租约骨架
- 仅观察态启用的战斗 HUD 与小地图红点 ROI 感知基线

尚未实现：

- HUD OCR：弹药、经济、血量和阶段
- 任务箭头和地图地标检测
- 怪物、弱点、红区和攻击前摇检测模型
- 真实目标 ID 跟踪指标和瞄准标定
- 地图路线图、补给点和攻击升级点资产
- 自动通关能力

## 数据工程阶段：ROI、标注与离线基准

GameModel 的第二阶段不直接开启自动战斗，而是先建立可复现的数据闭环：

```text
真实 HWND 捕获
  -> capture.mp4
  -> sampled PNG
  -> frames.index.jsonl
  -> versioned ROI calibration
  -> immutable dataset snapshot
  -> reviewed annotations
  -> detector predictions
  -> Replay Benchmark report
```

### 标注帧采样

`recordFrames=true` 时，WGC 在持续录像之外按 `datasetSampleFps` 写入 JPEG 标注帧。默认值为 2 FPS，可配置为 0-30 FPS；设置为 0 时保留 MP4 但不写标注帧。JPEG 编码避免全分辨率 PNG 压缩阻塞实时捕获，构建数据集时会保留实际图像格式与完整性摘要。

```json
{
  "action": "configure_capture",
  "capture_backend": "windows_graphics_capture",
  "capture_fps": 60,
  "record_frames": true,
  "dataset_sample_fps": 2
}
```

每个 PNG 都在 `frames.index.jsonl` 中绑定：会话 ID、单调序号、采集时间、原始帧哈希、PNG 哈希、窗口尺寸、运动量和黑帧指标。数据集构建时会重新计算 PNG SHA-256，文件被修改后会立即拒绝继续。

### ROI 校准

`save_calibration` 会重新捕获真实游戏窗口，并保存归一化 ROI、参考图、窗口尺寸、内容哈希和递增 revision。ROI 坐标均为 0-1 比例，因此可以随相同画面布局按分辨率缩放。

支持的区域包括：战斗画面、准星、阶段提示、弹药、经济、生命、交互提示、任务箭头、小地图、目标搜索区和威胁搜索区。坐标越界、重复 ROI ID 或没有真实参考图都会被拒绝。

### 确定性数据集

`build_dataset` 读取一个已结束会话，执行：

- 会话与 Profile 身份校验
- PNG SHA-256 完整性校验
- 原始帧哈希去重
- 黑帧和低运动帧过滤
- 时间轴均匀限量采样
- 基于 sample ID 的确定性 80/10/10 划分
- 将校准 manifest 与参考图快照进数据集
- 为每个样本创建 `unlabeled` 标注记录

```text
.leviathan/gamemodel/datasets/<dataset-id>/
  manifest.json
  samples.jsonl
  annotations.jsonl
  annotation-audit.jsonl
  calibration/
    manifest.json
    reference.png
  images/
    train/
    validation/
    test/
```

相同会话、校准和筛选参数会得到相同 dataset ID。数据集不会自动生成标签，也不会把捕获指标冒充 HUD 或目标真值。

### 标注审计

`get_annotation_sample` 返回指定样本，未指定 ID 时优先返回下一个 `unlabeled` 样本。`save_annotation` 支持 `annotated`、`reviewed` 和 `rejected` 状态，并记录 `manual`、`model` 或 `imported` 来源。

每次修改都会递增 revision，原子更新 `annotations.jsonl`，同步 manifest 哈希，并追加不可覆盖的 `annotation-audit.jsonl`。模型预标注必须标记为 `model`，人工检查后才能改为 `reviewed`。

### Detector Replay Benchmark

预测文件使用 JSONL，每行绑定一个 `sampleId` 和唯一 `detectorId`：

```json
{"schemaVersion":1,"sampleId":"sample_...","detectorId":"nzm-detector-v1","labels":{"phase":"combat","ammo":{"current":30},"boxes":[{"category":"enemy","rect":{"x":0.4,"y":0.2,"width":0.2,"height":0.5}}]}}
```

`evaluate_detector_benchmark` 当前报告：

- 样本与字段预测覆盖率
- 阶段和交互状态准确率
- 弹药、经济、生命值 MAE 与精确率
- 任务箭头角度 MAE 与 15 度内命中率
- 各类别及总体 IoU@0.5 Precision、Recall、F1
- 缺失预测、未知样本和图片完整性失败数
- 与同一 dataset ID 的基线报告差异及回归项

这一基准只评价数据集中真实存在并已标注的字段。没有标签时指标保持空值，不以默认值补造结果。

下一阶段应先使用 `observe + recordFrames` 采集授权环境中的录像，再建立 ROI 标定、标注集和离线 Replay Benchmark。没有验证集指标前，不应打开依赖对应字段的实时控制策略。

观察态 ROI 感知器的能力边界、真实录像开发抽查和 live 隔离规则见 [gamemodel-perception.md](./gamemodel-perception.md)。
