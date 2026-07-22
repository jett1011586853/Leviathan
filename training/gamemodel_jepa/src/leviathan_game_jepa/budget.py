from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

from .catalog import load_catalog
from .io_utils import write_json_atomic
from .records import APPROVED_RIGHTS, SourceRecord
from .splitting import assign_group_splits


SPLITS = ("train", "validation", "test")


def estimate_token_budget(config_path: Path) -> dict[str, Any]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    rate = video_token_rate(config)
    targets = token_targets(config)
    duration = float(config["clip"]["duration_seconds"])
    tokens_per_clip = round(rate * duration)
    return {
        "schema_version": 1,
        "definition": (
            "Unique spatiotemporal tokens at the configured sampling rate. "
            "Overlap, augmentation, and repeated epochs do not increase this count."
        ),
        "tokens_per_second": rate,
        "tokens_per_non_overlapping_clip": tokens_per_clip,
        "targets": {
            split: {
                "tokens": targets[split],
                "minimum_unique_hours": round(targets[split] / rate / 3600, 3),
                "minimum_non_overlapping_clips": math.ceil(
                    targets[split] / tokens_per_clip
                ),
            }
            for split in SPLITS
        },
        "total": {
            "tokens": sum(targets.values()),
            "minimum_unique_hours": round(sum(targets.values()) / rate / 3600, 3),
            "minimum_non_overlapping_clips": sum(
                math.ceil(targets[split] / tokens_per_clip) for split in SPLITS
            ),
        },
        "estimated_storage": {
            "source_video_at_4_mbps_gb": round(
                sum(targets.values()) / rate * 4_000_000 / 8 / 1_000_000_000, 1
            ),
            "source_video_at_8_mbps_gb": round(
                sum(targets.values()) / rate * 8_000_000 / 8 / 1_000_000_000, 1
            ),
            "source_video_at_12_mbps_gb": round(
                sum(targets.values()) / rate * 12_000_000 / 8 / 1_000_000_000, 1
            ),
        },
        "diversity_gates": config["data"]["token_budget"][
            "minimum_content_groups"
        ],
        "maximum_train_group_fraction": config["data"]["token_budget"][
            "maximum_train_group_fraction"
        ],
    }


def audit_catalog_budget(
    catalog_path: Path,
    config_path: Path,
    split_plan_path: Path | None = None,
    output_path: Path | None = None,
) -> dict[str, Any]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    minimum_relevance = float(config["data"]["minimum_relevance"])
    rate = video_token_rate(config)
    targets = token_targets(config)
    minimum_groups = config["data"]["token_budget"]["minimum_content_groups"]
    sources = [
        source
        for source in load_catalog(catalog_path)
        if source.relevance_score >= minimum_relevance
    ]
    assignments = _assignments_for_sources(sources, config, split_plan_path)

    approved_groups: dict[str, SourceRecord] = {}
    materialized_groups: dict[str, SourceRecord] = {}
    discovered_groups: dict[str, SourceRecord] = {}
    for source in sources:
        _keep_longest_group_source(discovered_groups, source)
        if source.rights_status not in APPROVED_RIGHTS:
            continue
        _keep_longest_group_source(approved_groups, source)
        local_path = source.resolved_local_path(catalog_path)
        if local_path is not None and local_path.is_file():
            _keep_longest_group_source(materialized_groups, source)

    approved_tokens = Counter({split: 0 for split in SPLITS})
    materialized_tokens = Counter({split: 0 for split in SPLITS})
    discovered_tokens = Counter({split: 0 for split in SPLITS})
    approved_group_counts = Counter({split: 0 for split in SPLITS})
    materialized_group_counts = Counter({split: 0 for split in SPLITS})
    discovered_group_counts = Counter({split: 0 for split in SPLITS})
    for group, source in discovered_groups.items():
        split = assignments.get(group, "train")
        discovered_tokens[split] += max(
            0, math.floor((source.duration_seconds or 0) * rate)
        )
        discovered_group_counts[split] += 1
    group_contributions: list[dict[str, Any]] = []
    for group, source in approved_groups.items():
        split = assignments.get(group, "train")
        tokens = max(0, math.floor((source.duration_seconds or 0) * rate))
        approved_tokens[split] += tokens
        approved_group_counts[split] += 1
        if group in materialized_groups:
            materialized_tokens[split] += tokens
            materialized_group_counts[split] += 1
        group_contributions.append(
            {
                "content_group_id": group,
                "source_id": source.source_id,
                "split": split,
                "tokens": tokens,
                "duration_seconds": source.duration_seconds,
                "rights_status": source.rights_status,
                "materialized": group in materialized_groups,
            }
        )

    split_reports: dict[str, Any] = {}
    for split in SPLITS:
        target = targets[split]
        actual = materialized_tokens[split]
        split_reports[split] = {
            "target_tokens": target,
            "approved_tokens": approved_tokens[split],
            "discovered_potential_tokens": discovered_tokens[split],
            "discovered_potential_progress": round(
                discovered_tokens[split] / target, 6
            )
            if target
            else 1.0,
            "materialized_tokens": actual,
            "progress": round(actual / target, 6) if target else 1.0,
            "missing_tokens": max(0, target - actual),
            "missing_unique_hours": round(max(0, target - actual) / rate / 3600, 3),
            "minimum_content_groups": int(minimum_groups[split]),
            "approved_content_groups": approved_group_counts[split],
            "discovered_content_groups": discovered_group_counts[split],
            "materialized_content_groups": materialized_group_counts[split],
            "token_gate_met": actual >= target,
            "diversity_gate_met": materialized_group_counts[split]
            >= int(minimum_groups[split]),
        }

    max_fraction = float(
        config["data"]["token_budget"]["maximum_train_group_fraction"]
    )
    oversized_train_groups = [
        item["content_group_id"]
        for item in group_contributions
        if item["split"] == "train"
        and item["tokens"] > targets["train"] * max_fraction
    ]
    report = {
        "schema_version": 1,
        "catalog": str(catalog_path.resolve()),
        "minimum_relevance": minimum_relevance,
        "tokens_per_second": rate,
        "strict_source_count": len(sources),
        "unknown_rights_source_count": sum(
            source.rights_status == "unknown" for source in sources
        ),
        "splits": split_reports,
        "total_materialized_tokens": sum(materialized_tokens.values()),
        "total_discovered_potential_tokens": sum(discovered_tokens.values()),
        "total_target_tokens": sum(targets.values()),
        "oversized_train_groups": oversized_train_groups,
        "ready": all(
            item["token_gate_met"] and item["diversity_gate_met"]
            for item in split_reports.values()
        )
        and not oversized_train_groups,
        "group_contributions": sorted(
            group_contributions, key=lambda item: (item["split"], item["source_id"])
        ),
    }
    if output_path is not None:
        write_json_atomic(output_path, report)
    return report


def video_token_rate(config: dict[str, Any]) -> float:
    clip = config["clip"]
    model = config["model"]
    frames_per_second = float(clip["frames"]) / float(clip["duration_seconds"])
    temporal_tokens_per_second = frames_per_second / int(model["tubelet_size"])
    spatial_tokens = (
        int(clip["width"]) // int(model["patch_size"])
    ) * (int(clip["height"]) // int(model["patch_size"]))
    rate = temporal_tokens_per_second * spatial_tokens
    if rate <= 0:
        raise ValueError("Video token rate must be positive")
    return rate


def token_targets(config: dict[str, Any]) -> dict[str, int]:
    value = config["data"]["token_budget"]
    targets = {split: int(value[split]) for split in SPLITS}
    if any(target <= 0 for target in targets.values()):
        raise ValueError("All token targets must be positive")
    return targets


def _assignments_for_sources(
    sources: list[SourceRecord],
    config: dict[str, Any],
    split_plan_path: Path | None,
) -> dict[str, str]:
    if split_plan_path is not None:
        plan = json.loads(split_plan_path.read_text(encoding="utf-8"))
        return {
            str(row["content_group_id"]): str(row["split"])
            for row in plan.get("sources", [])
            if isinstance(row, dict)
        }
    group_sizes: dict[str, int] = {}
    for source in sources:
        group_sizes[source.content_group_id] = max(
            group_sizes.get(source.content_group_id, 0),
            max(1, round(source.duration_seconds or 1)),
        )
    return assign_group_splits(
        group_sizes,
        {"train": 0.8, "validation": 0.1, "test": 0.1},
        int(config["seed"]),
    )


def _keep_longest_group_source(
    groups: dict[str, SourceRecord], source: SourceRecord
) -> None:
    current = groups.get(source.content_group_id)
    if current is None or (source.duration_seconds or 0) > (
        current.duration_seconds or 0
    ):
        groups[source.content_group_id] = source
