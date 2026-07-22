# Game-JEPA pilot execution record

Date: 2026-07-18

This record distinguishes engineering smoke results from research results. No accuracy or gameplay capability claim is made here.

## Environment

- GPU: NVIDIA GeForce RTX 4060 Laptop GPU, 8 GB
- Python: CPython 3.12.12 in an isolated virtual environment
- PyTorch: 2.12.0 + CUDA 13.0
- Video tools: FFmpeg/FFprobe 6.0.1
- Metadata discovery: yt-dlp 2026.03.17 plus public Bilibili metadata hydration

The machine's default Python 3.13 environment was not used because the available Windows PyTorch stack did not import reliably there. CUDA lazy module loading is set by the training entry point to avoid multi-minute eager initialization on Windows.

## Local owned capture smoke

An existing user-owned five-minute GameModel recording was registered through the provenance catalog.

- Source duration: 308.9 seconds
- Source resolution: 2560x1600 at 60 FPS
- Content group count: 1
- Extracted pilot clips: 4 clips, 4 seconds each
- Dataset ID: `gamejepa_dataset_e3fa501dfcd6be959c80`
- Integrity validation: passed; no missing files, digest errors, cross-group leakage or identical cross-split clips

Because all four clips came from one continuous source, all four remain in `train`. `validation` and `test` are intentionally empty. Splitting adjacent clips from the same recording across all three sets would create leakage and a misleading benchmark.

## Model execution smoke

The pilot model uses 8 frames at 112x112, a 192-dimensional tubelet encoder, four Transformer layers, an EMA target encoder and latent masked-region prediction.

- Parameter count: 4,373,760
- Device: CUDA
- Completed: forward pass, backward pass, gradient clipping, optimizer step, EMA target update and atomic checkpoint write
- Two-step smoke loss: 0.00539590 -> 0.00342700
- Two-step masked cosine similarity: -0.0360 -> 0.3420

These values only prove that the real-video training chain is executable. Two steps and four clips are not evidence that a representation has learned useful game semantics.

## Public source discovery

The crawler was run in metadata-only mode.

| Provider | Indexed | Strict “game + map” candidates | Downloaded |
| --- | ---: | ---: | ---: |
| Bilibili | 61 | 23 | 0 |
| YouTube | 10 | 1 | 0 |

The expanded strict Bilibili metadata plan contains 15 train sources, four validation sources and four test sources. Their combined potential size is about 1.23M video tokens, only about 1.97% of the 62.5M total target. All currently have `rights_status=unknown`, so the downloader correctly blocks them. Public availability, a platform download button or `no_reprint=0` is not treated as a machine-learning license.

Legacy《逆战》videos, BGM-only uploads and unrelated search results are excluded by the `1.0` relevance threshold. Simplified and traditional Chinese names are both recognized.

## What is complete

- Research architecture and falsifiable hypotheses
- Rights-aware source catalog
- Local video registration and SHA-256 provenance
- Metadata crawlers for Bilibili and YouTube
- License inference for explicit Creative Commons metadata
- Policy-gated downloader
- Visual fingerprint and duplicate grouping
- Deterministic source-level split planning
- Frozen split-plan support during materialization
- FFmpeg clip extraction and validation
- GPU-executable JEPA pretraining model
- Action-conditioned latent dynamics module interface
- Atomic reports and checkpoints
- 50M train-token and diversity hard gate
- Scalable source-window indexing without per-window MP4 duplication

## What is not complete

- No public video has been approved for download or training.
- No reviewed validation/test labels exist.
- No synchronized key/mouse trajectory dataset exists.
- No action-conditioned dynamics experiment, MPC planner or live model integration has been validated.
- No paper-level result or gameplay improvement has been established.

## Next data gate

1. Materialize at least 50M unique train video tokens plus 6.25M validation and 6.25M test tokens. Under the fixed pilot tokenizer this is about 354.3 total unique video hours.
2. Use at least 50 independent train content groups and 10 groups each for validation/test; cap one train group at 2% of the train token budget.
3. Obtain permission or a compatible license for strict-scope public sources, or collect enough independent owned runs to meet that budget.
4. Freeze source groups before downloading/materializing the dataset.
5. Build a reviewed validation/test label set for phase, location, HUD resources, targets and events.
6. Run random initialization, single-frame, current ROI detector and Game-JEPA ablations with identical splits.
7. Add synchronized action capture before training action-conditioned dynamics.
