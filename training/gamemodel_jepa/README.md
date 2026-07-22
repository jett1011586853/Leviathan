# Leviathan Game-JEPA training base

This package is the offline data and training plane for the `com.leviathan.game.nzm-future` GameModel profile. The pilot scope is limited to the “丛林魅影” map.

It provides:

- provenance and rights-aware source catalogs;
- local video registration and public-video metadata discovery;
- policy-gated downloads without DRM or access-control bypass;
- deterministic video clipping and group-isolated train/validation/test splits;
- a compact latent video prediction model for an 8 GB development GPU;
- an action-conditioned latent dynamics module for future synchronized trajectories;
- manifests and validation reports suitable for reproducible experiments.

Research-stage decisions and gates:

- [Stage 2 representation selection](docs/STAGE_2_REPRESENTATION_SELECTION.md)
- [Stage 3 action-conditioned token-grid dynamics](docs/STAGE_3_ACTION_DYNAMICS.md)

The formal data gate is 50M unique train video tokens, plus 6.25M validation and 6.25M test tokens. With the fixed pilot tokenizer this is approximately 354.3 total unique video hours. Overlapping windows and repeated epochs do not increase the unique-token count.

Public web videos default to metadata-only discovery. A source must be marked `user_owned`, `permissive`, `explicit_permission`, or `public_domain` before the downloader accepts it.

Downloaded files that already have a matching catalog record must use `attach-downloaded`, not `register-local`. The command checks duration, hashes the file, rejects exact duplicates, records its candidate role, and deliberately leaves its existing rights status unchanged:

```powershell
leviathan-game-jepa attach-downloaded --catalog data\public\bilibili-expanded.jsonl --source-id source_... --video "D:\path\video.mp4" --candidate-role continuous_gameplay
```

Use `visual_reference` for cinematics or scene-only material that must not enter action-dynamics training. `register-local` is reserved for gameplay captures actually owned by the user.

For a user-authorized, local-only research experiment, mark attached sources as `private_research` and opt in explicitly during preparation. This status never passes formal dataset, publication, or distribution gates:

```powershell
leviathan-game-jepa set-rights --catalog data\public\bilibili-expanded.jsonl --source-id source_... --status private_research --evidence "User authorized local-only private research; no redistribution."
leviathan-game-jepa prepare-index --catalog data\public\bilibili-expanded.jsonl --output data\research-index --config configs\jungle_phantom_pilot.json --allow-private-research --candidate-role continuous_gameplay
leviathan-game-jepa train-jepa --dataset data\research-index --config configs\jungle_phantom_pilot.json --output runs\research-baseline --max-steps 20 --smoke
leviathan-game-jepa evaluate-jepa --dataset data\research-index --config configs\jungle_phantom_pilot.json --checkpoint runs\research-baseline\checkpoint-last.pt --output runs\research-baseline\validation-evaluation.json --split validation
```

## Python environment

Use CPython 3.12 on Windows. The main Miniconda Python 3.13 environment is intentionally unsupported because the current PyTorch Windows stack used by this project targets Python 3.9-3.12.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -e ".[train,test]"
```

`ffmpeg`, `ffprobe`, and `yt-dlp` must be available on `PATH` for media operations.

## Pilot workflow

```powershell
leviathan-game-jepa register-local --video "C:\path\capture.mp4" --catalog data\sources.jsonl --title "owned jungle phantom capture"
leviathan-game-jepa prepare --catalog data\sources.jsonl --output data\pilot --config configs\jungle_phantom_pilot.json --max-clips 8
leviathan-game-jepa validate --dataset data\pilot
leviathan-game-jepa train-jepa --dataset data\pilot --config configs\jungle_phantom_pilot.json --output runs\pilot --max-steps 20 --smoke
```

For the formal 50M-token corpus, do not create hundreds of thousands of MP4 files. Build a source-window index and decode windows directly from each source video:

```powershell
leviathan-game-jepa prepare-index --catalog data\sources.jsonl --output data\indexed --config configs\jungle_phantom_pilot.json --split-plan data\public_split_plan.json
leviathan-game-jepa validate-index --dataset data\indexed
leviathan-game-jepa train-jepa --dataset data\indexed --config configs\jungle_phantom_pilot.json --output runs\indexed
```

Formal training refuses to start until every token and content-group gate in the configuration is met. `--smoke` is the explicit engineering-only bypass; resulting model packages are marked as smoke checkpoints and remain ineligible for live use.

Discovering public metadata does not download media:

```powershell
leviathan-game-jepa discover --catalog data\public_sources.jsonl --provider bilibili --limit 20
leviathan-game-jepa plan-splits --catalog data\public_sources.jsonl --output data\public_split_plan.json
leviathan-game-jepa estimate-budget --config configs\jungle_phantom_pilot.json
leviathan-game-jepa audit-budget --catalog data\public_sources.jsonl --config configs\jungle_phantom_pilot.json --split-plan data\public_split_plan.json --output data\budget-report.json
```

## 已登录平台访问

不要把 Cookie 文本、Cookie 文件、API Token 或浏览器数据库复制到仓库、命令行参数或数据目录。需要检查大会员账号可见的视频规格时，直接读取本机已登录浏览器的会话：

```powershell
leviathan-game-jepa probe-access --url "https://www.bilibili.com/video/BV..." --cookies-from-browser edge
leviathan-game-jepa discover --catalog data\public_sources.jsonl --provider bilibili --limit 20 --cookies-from-browser edge
```

支持 `brave`、`chrome`、`edge` 和 `firefox`。访问探测只读取元数据，不下载视频，也不会输出或持久化 Cookie。下载已完成授权审查的来源时，可在 `download` 命令末尾使用同一个选项。

平台会员资格只解决账号可访问的视频规格，不代表训练、再分发或公开数据集授权。发现的网络视频仍保持 `rights_status=unknown`，必须取得创作者许可、宽松许可证、公共领域依据或确认是本人拥有的录制内容，才能通过下载门禁。

Review `rights_status` and source relevance before any download. Never relabel a source without evidence.
The pilot configuration requires a relevance score of `1.0`, meaning both the game name and map name must be present in discovered metadata; map-name-only legacy videos are excluded.
Pass the reviewed plan back to `prepare` with `--split-plan` so later downloads do not silently move a source between train, validation, and test.
