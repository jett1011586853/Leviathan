# GameModel 观察态感知基线

`com.leviathan.game.nzm-future` Profile 包含一个仅观察态启用的确定性 ROI 感知器。它不是目标检测模型，也没有被声明为已通过验证的自动战斗能力。

## 启用条件

- GameModel 会话为 `observe`
- Capture backend 为 `windows_graphics_capture`
- `recordFrames=true` 且 `datasetSampleFps>0`
- 当前工作区存在与 Profile 匹配的校准文件

感知器只处理 WGC 已经写出的数据集采样帧，不处理每一张 60 FPS 捕获帧。它在 adapter descriptor 中仅声明并输出：

- `game.phase`：有足够 HUD 证据时输出 `combat`，否则输出 `unknown`
- `vision.threats`：提取小地图内的红色连通域，输出相对方向和置信度；不会仅凭红点声称攻击即将发生

顶部罗盘中的彩色候选目前容易与文字或场景颜色混淆，因此目标方向只保留在 detector diagnostics 中，不声明 `navigation.objective_arrow` capability，也不会写入可信世界状态。

## 安全边界

- `live` 模式不会加载该感知器
- 采样图像路径必须位于当前会话目录
- 分析前重新计算 JPEG SHA-256，并与 native capture event 匹配
- 单帧感知失败只记入 detector error diagnostics，不会中断 WGC 捕获
- 没有识别到战斗 HUD 时显式输出 `unknown` 和空威胁列表，避免旧战斗状态残留

## 真实录像开发抽查

2026-07-16 使用真实五分钟会话做了开发抽查：

- 从 565 张采样帧中等间隔抽取 29 张
- 25 张具有正常战斗 HUD，均输出 `combat`
- 4 张为大地图、阶段结算、黑屏过渡或商店覆盖层，均未提升为 `combat`
- 单张 2560x1600 JPEG 在 960 像素分析宽度下平均约 38.84 ms，范围约 29.17-55.14 ms
- 该成本只发生在 2 FPS 采样帧上，不代表 60 FPS 逐帧模型推理

以上是开发抽查，不是准确率、召回率或跨场景性能指标。当前 400 张确定性数据集仍没有 reviewed ground truth，因此正式 Benchmark 指标必须保持空值。下一步需要对 `validation` 和 `test` split 完成人工复核，再决定阶段与小地图威胁 capability 是否可以进入 `live`。
