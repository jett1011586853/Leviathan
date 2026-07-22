from __future__ import annotations

import json
import math
import os
import platform
import random
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .io_utils import sha256_file, write_json_atomic
from .models import (
    GameJepaConfig,
    build_game_jepa,
    build_token_grid_action_dynamics,
    token_grid_dynamics_loss,
)
from .video_dataset import FFmpegClipDataset


def _configure_cuda_environment() -> None:
    # CUDA 13 on Windows may spend minutes eagerly loading every module.
    os.environ.setdefault("CUDA_MODULE_LOADING", "LAZY")
    os.environ.setdefault("PYTORCH_NVML_BASED_CUDA_CHECK", "1")


def train_jepa(
    dataset_dir: Path,
    config_path: Path,
    output_dir: Path,
    max_steps_override: int | None = None,
    smoke: bool = False,
) -> dict[str, Any]:
    _configure_cuda_environment()
    try:
        import numpy as np
        import torch
    except ImportError as error:
        raise RuntimeError("Install the training extra before training") from error

    config = json.loads(config_path.read_text(encoding="utf-8"))
    dataset_manifest = json.loads(
        (dataset_dir / "manifest.json").read_text(encoding="utf-8")
    )
    usage_policy = dataset_manifest.get("usage_policy") or {}
    private_research = bool(usage_policy.get("private_research"))
    if private_research and not smoke:
        raise ValueError(
            "Private-research datasets require --smoke and cannot produce a formal checkpoint"
        )
    if not smoke:
        _enforce_formal_data_gate(dataset_manifest, config)
    model_config = GameJepaConfig.from_experiment(config)
    training_config = config["training"]
    seed = int(config["seed"])
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    dataset = FFmpegClipDataset(
        dataset_dir=dataset_dir,
        split="train",
        frames=model_config.frames,
        width=model_config.width,
        height=model_config.height,
    )
    if len(dataset) == 0:
        raise ValueError("The training split has no clips")
    generator = torch.Generator().manual_seed(seed)
    loader = torch.utils.data.DataLoader(
        dataset,
        batch_size=int(training_config["batch_size"]),
        shuffle=True,
        num_workers=int(training_config["num_workers"]),
        pin_memory=torch.cuda.is_available(),
        drop_last=False,
        generator=generator,
    )
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_game_jepa(model_config).to(device)
    optimizer = torch.optim.AdamW(
        [parameter for parameter in model.parameters() if parameter.requires_grad],
        lr=float(training_config["learning_rate"]),
        weight_decay=float(training_config["weight_decay"]),
    )
    use_amp = bool(training_config["mixed_precision"]) and device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    accumulation = int(training_config["gradient_accumulation"])
    max_steps = int(max_steps_override or training_config["max_steps"])
    if accumulation <= 0 or max_steps <= 0:
        raise ValueError("gradient_accumulation and max_steps must be positive")

    output_dir.mkdir(parents=True, exist_ok=True)
    model.train()
    optimizer.zero_grad(set_to_none=True)
    history: list[dict[str, float | int]] = []
    optimizer_step = 0
    micro_step = 0
    while optimizer_step < max_steps:
        for batch in loader:
            video = batch["video"].to(device, non_blocking=True)
            with torch.amp.autocast(device_type=device.type, enabled=use_amp):
                output = model(video)
                scaled_loss = output["loss"] / accumulation
            scaler.scale(scaled_loss).backward()
            micro_step += 1
            if micro_step % accumulation:
                continue
            scaler.unscale_(optimizer)
            gradient_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
            model.update_target()
            optimizer_step += 1
            history_entry: dict[str, float | int] = {
                "step": optimizer_step,
                "loss": round(float(output["loss"].detach().cpu()), 8),
                "masked_cosine_similarity": round(
                    float(output["masked_cosine_similarity"].cpu()), 8
                ),
                "gradient_norm": round(float(gradient_norm.detach().cpu()), 8),
            }
            for metric_name in (
                "token_prediction_loss",
                "state_prediction_loss",
                "state_cosine_similarity",
                "variance_loss",
                "covariance_loss",
                "state_diversity_loss",
                "contrastive_loss",
                "contrastive_accuracy",
            ):
                if metric_name in output:
                    history_entry[metric_name] = round(
                        float(output[metric_name].cpu()), 8
                    )
            history.append(history_entry)
            if optimizer_step >= max_steps:
                break

    checkpoint_path = output_dir / "checkpoint-last.pt"
    temporary = checkpoint_path.with_suffix(".tmp.pt")
    torch.save(
        {
            "schema_version": 1,
            "experiment_id": config["experiment_id"],
            "model_config": asdict(model_config),
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "step": optimizer_step,
            "seed": seed,
        },
        temporary,
    )
    temporary.replace(checkpoint_path)
    checkpoint_sha256 = sha256_file(checkpoint_path)
    report = {
        "schema_version": 1,
        "experiment_id": config["experiment_id"],
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dataset_dir": str(dataset_dir.resolve()),
        "dataset_id": dataset_manifest.get("dataset_id"),
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "python": platform.python_version(),
        "torch": torch.__version__,
        "steps": optimizer_step,
        "training_samples": len(dataset),
        "storage_kind": dataset_manifest.get("storage_kind", "materialized_clip"),
        "smoke": smoke,
        "formal_data_gate_enforced": not smoke,
        "private_research": private_research,
        "distribution_eligible": not private_research,
        "checkpoint": str(checkpoint_path.resolve()),
        "checkpoint_sha256": checkpoint_sha256,
        "history": history,
    }
    write_json_atomic(output_dir / "training-report.json", report)
    write_json_atomic(
        output_dir / "model-package.json",
        {
            "schema_version": 1,
            "package_kind": "offline_game_jepa_checkpoint",
            "experiment_id": config["experiment_id"],
            "dataset_id": dataset_manifest.get("dataset_id"),
            "checkpoint": checkpoint_path.name,
            "checkpoint_sha256": checkpoint_sha256,
            "capabilities": ["offline.latent_video_representation"],
            "live_eligible": False,
            "distribution_eligible": not private_research,
            "private_research": private_research,
            "smoke": smoke,
            "reason": (
                "Private-research checkpoint. Source media, derived data, and model "
                "weights are restricted to local evaluation."
                if private_research
                else (
                    "This checkpoint has not passed reviewed validation/test benchmarks "
                    "or action-conditioned control gates."
                    if not smoke
                    else "Smoke checkpoint trained below the formal token/diversity gate."
                )
            ),
        },
    )
    return report


def evaluate_jepa(
    dataset_dir: Path,
    config_path: Path,
    checkpoint_path: Path,
    output_path: Path,
    split: str = "validation",
    max_batches: int = 32,
) -> dict[str, Any]:
    _configure_cuda_environment()
    try:
        import numpy as np
        import torch
    except ImportError as error:
        raise RuntimeError("Install the training extra before evaluation") from error
    if split not in {"train", "validation", "test"}:
        raise ValueError("split must be train, validation, or test")
    if max_batches <= 0:
        raise ValueError("max_batches must be positive")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    manifest = json.loads((dataset_dir / "manifest.json").read_text(encoding="utf-8"))
    model_config = GameJepaConfig.from_experiment(config)
    seed = int(config["seed"])
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dataset = FFmpegClipDataset(
        dataset_dir=dataset_dir,
        split=split,
        frames=model_config.frames,
        width=model_config.width,
        height=model_config.height,
    )
    if len(dataset) == 0:
        raise ValueError(f"The {split} split has no samples")
    loader = torch.utils.data.DataLoader(
        dataset,
        batch_size=int(config["training"]["batch_size"]),
        shuffle=False,
        num_workers=0,
        pin_memory=torch.cuda.is_available(),
        drop_last=False,
    )

    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    trained = build_game_jepa(model_config).to(device)
    trained.load_state_dict(checkpoint["model"], strict=True)
    torch.manual_seed(seed)
    baseline = build_game_jepa(model_config).to(device)
    trained_metrics = _evaluate_model(trained, loader, device, max_batches, seed)
    baseline_metrics = _evaluate_model(baseline, loader, device, max_batches, seed)
    representation_gate = _representation_selection_gate(
        trained_metrics, baseline_metrics
    )
    report = {
        "schema_version": 1,
        "experiment_id": config["experiment_id"],
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dataset_id": manifest.get("dataset_id"),
        "split": split,
        "dataset_samples": len(dataset),
        "evaluated_samples": trained_metrics["samples"],
        "max_batches": max_batches,
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "checkpoint": str(checkpoint_path.resolve()),
        "checkpoint_sha256": sha256_file(checkpoint_path),
        "private_research": bool(
            (manifest.get("usage_policy") or {}).get("private_research")
        ),
        "trained": trained_metrics,
        "untrained_baseline": baseline_metrics,
        "delta": {
            "masked_cosine_similarity": round(
                trained_metrics["masked_cosine_similarity"]
                - baseline_metrics["masked_cosine_similarity"],
                8,
            ),
            "loss": round(trained_metrics["loss"] - baseline_metrics["loss"], 8),
            "effective_rank": round(
                trained_metrics["representation"]["effective_rank"]
                - baseline_metrics["representation"]["effective_rank"],
                8,
            ),
            "pooled_effective_rank": round(
                trained_metrics["representation"]["effective_rank"]
                - baseline_metrics["representation"]["effective_rank"],
                8,
            ),
            "token_grid_effective_rank": round(
                trained_metrics["token_grid_representation"]["effective_rank"]
                - baseline_metrics["token_grid_representation"]["effective_rank"],
                8,
            ),
        },
        "representation_gate": representation_gate,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(output_path, report)
    return report


def _evaluate_model(model, loader, device, max_batches: int, seed: int) -> dict[str, Any]:
    import torch

    model.eval()
    torch.manual_seed(seed)
    losses: list[float] = []
    cosines: list[float] = []
    component_values: dict[str, list[float]] = {
        name: []
        for name in (
            "token_prediction_loss",
            "state_prediction_loss",
            "state_cosine_similarity",
            "variance_loss",
            "covariance_loss",
            "state_diversity_loss",
            "contrastive_loss",
            "contrastive_accuracy",
        )
    }
    embeddings = []
    online_embeddings = []
    token_grid_embeddings = []
    online_token_grid_embeddings = []
    samples = 0
    with torch.no_grad():
        for batch_index, batch in enumerate(loader):
            if batch_index >= max_batches:
                break
            video = batch["video"].to(device, non_blocking=True)
            output = model(video)
            losses.append(float(output["loss"].cpu()))
            cosines.append(float(output["masked_cosine_similarity"].cpu()))
            for metric_name, values in component_values.items():
                if metric_name in output:
                    values.append(float(output[metric_name].cpu()))
            embeddings.append(model.encode(video).float().cpu())
            online_embeddings.append(model.encode_online(video).float().cpu())
            token_grid_embeddings.append(
                model.encode_token_grid(video).flatten(1).float().cpu()
            )
            online_token_grid_embeddings.append(
                model.encode_online_token_grid(video).flatten(1).float().cpu()
            )
            samples += int(video.shape[0])
    states = torch.cat(embeddings, dim=0)
    online_states = torch.cat(online_embeddings, dim=0)
    token_grid_states = torch.cat(token_grid_embeddings, dim=0)
    online_token_grid_states = torch.cat(online_token_grid_embeddings, dim=0)
    normalized_states = torch.nn.functional.normalize(states, dim=-1)
    normalized_online_states = torch.nn.functional.normalize(online_states, dim=-1)
    result = {
        "samples": samples,
        "loss": round(sum(losses) / len(losses), 8),
        "masked_cosine_similarity": round(sum(cosines) / len(cosines), 8),
        "representation": _representation_metrics(states),
        "online_representation": _representation_metrics(online_states),
        "token_grid_representation": _representation_metrics(token_grid_states),
        "online_token_grid_representation": _representation_metrics(
            online_token_grid_states
        ),
        "target_online_cosine_similarity": round(
            float((normalized_states * normalized_online_states).sum(dim=-1).mean()),
            8,
        ),
    }
    result.update(
        {
            metric_name: round(sum(values) / len(values), 8)
            for metric_name, values in component_values.items()
            if values
        }
    )
    return result


def _representation_metrics(states) -> dict[str, float]:
    import torch

    normalized = torch.nn.functional.normalize(states, dim=-1)
    similarities = normalized @ normalized.T
    count = states.shape[0]
    pairwise = (
        (similarities.sum() - similarities.diag().sum()) / (count * (count - 1))
        if count > 1
        else torch.tensor(1.0)
    )
    centered = states - states.mean(dim=0, keepdim=True)
    sample_gram = centered @ centered.T / max(1, count - 1)
    eigenvalues = torch.linalg.eigvalsh(sample_gram).clamp_min(0)
    total = eigenvalues.sum()
    if float(total) > 0:
        probabilities = eigenvalues / total
        positive = probabilities[probabilities > 0]
        effective_rank = torch.exp(-(positive * positive.log()).sum())
    else:
        effective_rank = torch.tensor(0.0)
    return {
        "mean_feature_std": round(float(states.std(dim=0).mean()), 8),
        "mean_pairwise_cosine_similarity": round(float(pairwise), 8),
        "effective_rank": round(float(effective_rank), 8),
        "mean_embedding_norm": round(float(states.norm(dim=-1).mean()), 8),
    }


def _representation_selection_gate(
    trained_metrics: dict[str, Any], baseline_metrics: dict[str, Any]
) -> dict[str, Any]:
    trained_grid = trained_metrics["token_grid_representation"]
    baseline_grid = baseline_metrics["token_grid_representation"]
    baseline_rank = float(baseline_grid["effective_rank"])
    rank_retention = (
        float(trained_grid["effective_rank"]) / baseline_rank
        if baseline_rank > 0
        else 0.0
    )
    pairwise_delta = float(trained_grid["mean_pairwise_cosine_similarity"]) - float(
        baseline_grid["mean_pairwise_cosine_similarity"]
    )
    thresholds = {
        "minimum_masked_cosine_similarity": 0.9,
        "minimum_token_grid_rank_retention": 0.9,
        "maximum_pairwise_cosine_increase": 0.02,
    }
    checks = {
        "prediction_quality": float(trained_metrics["masked_cosine_similarity"])
        >= thresholds["minimum_masked_cosine_similarity"],
        "token_grid_rank_retention": rank_retention
        >= thresholds["minimum_token_grid_rank_retention"],
        "token_grid_pairwise_similarity": pairwise_delta
        <= thresholds["maximum_pairwise_cosine_increase"],
    }
    return {
        "passed": all(checks.values()),
        "primary_representation": "target_token_grid",
        "thresholds": thresholds,
        "observed": {
            "masked_cosine_similarity": round(
                float(trained_metrics["masked_cosine_similarity"]), 8
            ),
            "token_grid_rank_retention": round(rank_retention, 8),
            "pairwise_cosine_increase": round(pairwise_delta, 8),
        },
        "checks": checks,
    }


def _enforce_formal_data_gate(
    dataset_manifest: dict[str, Any], config: dict[str, Any]
) -> None:
    token_counts = dataset_manifest.get("unique_video_tokens")
    group_counts = dataset_manifest.get("content_group_counts")
    if not isinstance(token_counts, dict) or not isinstance(group_counts, dict):
        raise ValueError(
            "Formal training requires a source-window dataset with unique token and "
            "content-group counts. Use --smoke only for engineering checks."
        )
    budget = config["data"]["token_budget"]
    failures: list[str] = []
    for split in ("train", "validation", "test"):
        actual_tokens = int(token_counts.get(split, 0))
        required_tokens = int(budget[split])
        actual_groups = int(group_counts.get(split, 0))
        required_groups = int(budget["minimum_content_groups"][split])
        if actual_tokens < required_tokens:
            failures.append(
                f"{split} tokens {actual_tokens:,} < {required_tokens:,}"
            )
        if actual_groups < required_groups:
            failures.append(
                f"{split} content groups {actual_groups} < {required_groups}"
            )
    if failures:
        raise ValueError("Formal data gate failed: " + "; ".join(failures))


def smoke_model(config_path: Path, output_dir: Path) -> dict[str, Any]:
    _configure_cuda_environment()
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("Install the training extra before the model smoke test") from error
    config = json.loads(config_path.read_text(encoding="utf-8"))
    model_config = GameJepaConfig.from_experiment(config)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_game_jepa(model_config).to(device)
    optimizer = torch.optim.AdamW(
        [parameter for parameter in model.parameters() if parameter.requires_grad], lr=1e-4
    )
    video = torch.rand(
        1,
        3,
        model_config.frames,
        model_config.height,
        model_config.width,
        device=device,
    )
    output = model(video)
    output["loss"].backward()
    optimizer.step()
    model.update_target()
    report = {
        "schema_version": 1,
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "loss": float(output["loss"].detach().cpu()),
        "masked_cosine_similarity": float(
            output["masked_cosine_similarity"].cpu()
        ),
        "parameter_count": sum(parameter.numel() for parameter in model.parameters()),
    }
    for metric_name in (
        "token_prediction_loss",
        "state_prediction_loss",
        "state_cosine_similarity",
        "variance_loss",
        "covariance_loss",
        "state_diversity_loss",
        "contrastive_loss",
        "contrastive_accuracy",
    ):
        if metric_name in output:
            report[metric_name] = float(output[metric_name].cpu())
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json_atomic(output_dir / "model-smoke-report.json", report)
    return report


def smoke_dynamics(
    config_path: Path, output_dir: Path, steps: int = 40
) -> dict[str, Any]:
    _configure_cuda_environment()
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("Install the training extra before dynamics smoke") from error
    if steps <= 0:
        raise ValueError("steps must be positive")
    experiment = json.loads(config_path.read_text(encoding="utf-8"))
    model_config = GameJepaConfig.from_experiment(experiment)
    seed = int(experiment["seed"])
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_token_grid_action_dynamics(model_config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    batch_size = 4
    horizon = 3
    initial = torch.randn(
        batch_size,
        model_config.token_count,
        model_config.embedding_dim,
        device=device,
    )
    actions = torch.empty(
        batch_size, horizon, model_config.action_dim, device=device
    ).uniform_(-1, 1)
    delta_seconds = torch.empty(batch_size, horizon, device=device).uniform_(
        1 / 30, 1 / 10
    )
    action_projection = torch.randn(
        model_config.action_dim, model_config.embedding_dim, device=device
    ) * 0.04
    time_projection = torch.randn(model_config.embedding_dim, device=device) * 0.02
    targets = []
    target_state = initial
    for horizon_index in range(horizon):
        effect = actions[:, horizon_index] @ action_projection
        effect = effect + delta_seconds[:, horizon_index].unsqueeze(-1) * time_projection
        target_state = target_state + effect.unsqueeze(1)
        targets.append(target_state)
    target_grid = torch.stack(targets, dim=1).detach()

    model.eval()
    with torch.no_grad():
        initial_prediction = model(initial, actions, delta_seconds)
        initial_metrics = token_grid_dynamics_loss(initial_prediction, target_grid)
        initial_mse = float((initial_prediction["mean"] - target_grid).square().mean())
    model.train()
    loss_history = []
    for step in range(steps):
        prediction = model(initial, actions, delta_seconds)
        metrics = token_grid_dynamics_loss(prediction, target_grid)
        optimizer.zero_grad(set_to_none=True)
        metrics["loss"].backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        if step in {0, steps - 1}:
            loss_history.append(
                {"step": step + 1, "loss": float(metrics["loss"].detach().cpu())}
            )
    model.eval()
    with torch.no_grad():
        final_prediction = model(initial, actions, delta_seconds)
        final_metrics = token_grid_dynamics_loss(final_prediction, target_grid)
        final_mse = float((final_prediction["mean"] - target_grid).square().mean())
    mse_ratio = final_mse / initial_mse if initial_mse > 0 else 0.0
    report = {
        "schema_version": 1,
        "kind": "synthetic_token_grid_dynamics_smoke",
        "experiment_id": experiment["experiment_id"],
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "steps": steps,
        "batch_size": batch_size,
        "horizon": horizon,
        "token_count": model_config.token_count,
        "embedding_dim": model_config.embedding_dim,
        "parameter_count": sum(parameter.numel() for parameter in model.parameters()),
        "initial": _dynamics_metrics_to_json(initial_metrics, initial_mse),
        "final": _dynamics_metrics_to_json(final_metrics, final_mse),
        "mse_ratio": round(mse_ratio, 8),
        "passed": bool(math.isfinite(mse_ratio) and mse_ratio < 0.8),
        "scope": "Synthetic learnability check only; not evidence of game control.",
        "history": loss_history,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json_atomic(output_dir / "dynamics-smoke-report.json", report)
    return report


def _dynamics_metrics_to_json(metrics: dict[str, Any], mse: float) -> dict[str, Any]:
    return {
        "loss": round(float(metrics["loss"].detach().cpu()), 8),
        "mse": round(mse, 8),
        "gaussian_nll": round(float(metrics["gaussian_nll"].cpu()), 8),
        "mean_cosine_similarity": round(
            float(metrics["mean_cosine_similarity"].cpu()), 8
        ),
        "mean_predicted_std": round(float(metrics["mean_predicted_std"].cpu()), 8),
        "per_horizon_mse": [
            round(float(value), 8) for value in metrics["per_horizon_mse"].cpu()
        ],
        "per_horizon_cosine_similarity": [
            round(float(value), 8)
            for value in metrics["per_horizon_cosine_similarity"].cpu()
        ],
    }
