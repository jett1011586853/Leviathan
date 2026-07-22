from __future__ import annotations

import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .catalog import load_catalog
from .io_utils import read_jsonl, sha256_file, stable_id, write_json_atomic, write_jsonl_atomic
from .media import extract_clip, probe_video
from .records import (
    APPROVED_RIGHTS,
    RESEARCH_ONLY_RIGHTS,
    ClipRecord,
    SourceRecord,
    SourceWindowRecord,
)
from .splitting import assign_group_splits, validate_group_isolation


def prepare_dataset(
    catalog_path: Path,
    output_dir: Path,
    config_path: Path,
    max_clips: int | None = None,
    split_plan_path: Path | None = None,
    allow_private_research: bool = False,
    candidate_role: str | None = None,
) -> dict[str, Any]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    clip_config = config["clip"]
    split_config = config["split"]
    duration = float(clip_config["duration_seconds"])
    stride = float(clip_config["stride_seconds"])
    if duration <= 0 or stride <= 0:
        raise ValueError("Clip duration and stride must be positive")

    minimum_relevance = float(config.get("data", {}).get("minimum_relevance", 1.0))
    sources = _eligible_sources(
        catalog_path,
        minimum_relevance,
        allow_private_research,
        candidate_role,
    )
    if not sources:
        raise ValueError("No eligible, relevant, locally available sources in catalog")
    candidates: list[tuple[SourceRecord, float]] = []
    for source in sources:
        source_path = source.resolved_local_path(catalog_path)
        assert source_path is not None
        probe = probe_video(source_path)
        start = 0.0
        while start + duration <= probe.duration_seconds + 1e-6:
            candidates.append((source, start))
            start += stride
    candidates.sort(key=lambda item: (item[0].source_id, item[1]))
    if max_clips is not None:
        candidates = _select_evenly(candidates, max_clips)
    if not candidates:
        raise ValueError("No complete clips can be extracted from approved sources")

    group_sizes = Counter(source.content_group_id for source, _ in candidates)
    if split_plan_path is not None:
        assignments = _load_split_plan(split_plan_path, set(group_sizes))
    else:
        assignments = assign_group_splits(
            dict(group_sizes),
            {
                "train": float(split_config["train"]),
                "validation": float(split_config["validation"]),
                "test": float(split_config["test"]),
            },
            int(config["seed"]),
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    records: list[ClipRecord] = []
    for source, start in candidates:
        source_path = source.resolved_local_path(catalog_path)
        assert source_path is not None
        split = assignments[source.content_group_id]
        clip_id = stable_id(
            "clip", source.source_id, f"{start:.3f}", f"{duration:.3f}"
        )
        relative_path = Path("clips") / split / f"{clip_id}.mp4"
        destination = output_dir / relative_path
        if not destination.exists():
            extract_clip(source_path, destination, start, duration)
        probe = probe_video(destination)
        records.append(
            ClipRecord(
                schema_version=1,
                clip_id=clip_id,
                source_id=source.source_id,
                content_group_id=source.content_group_id,
                split=split,  # type: ignore[arg-type]
                local_path=relative_path.as_posix(),
                start_seconds=round(start, 3),
                end_seconds=round(start + duration, 3),
                duration_seconds=round(probe.duration_seconds, 3),
                sha256=sha256_file(destination),
                width=probe.width,
                height=probe.height,
                fps=round(probe.fps, 6),
                frame_count=probe.frame_count,
                rights_status=source.rights_status,
                map_name=source.map_name,
            )
        )

    write_jsonl_atomic(output_dir / "clips.jsonl", (record.as_dict() for record in records))
    write_jsonl_atomic(
        output_dir / "sources.snapshot.jsonl", (source.as_dict() for source in sources)
    )
    counts = Counter(record.split for record in records)
    group_counts = Counter(
        {
            split: len(
                {
                    record.content_group_id
                    for record in records
                    if record.split == split
                }
            )
            for split in ("train", "validation", "test")
        }
    )
    warnings: list[str] = []
    if len(group_sizes) < 3:
        warnings.append(
            "Fewer than three independent content groups: validation/test cannot both be isolated."
        )
    for split in ("train", "validation", "test"):
        if counts[split] == 0:
            warnings.append(f"Split '{split}' is empty.")
    manifest = {
        "schema_version": 1,
        "dataset_id": stable_id(
            "gamejepa_dataset",
            config["experiment_id"],
            [(record.clip_id, record.sha256, record.split) for record in records],
            length=20,
        ),
        "experiment_id": config["experiment_id"],
        "game": config["game"],
        "map": config["map"],
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_catalog": str(catalog_path.resolve()),
        "source_count": len(sources),
        "content_group_count": len(group_sizes),
        "clip_count": len(records),
        "split_counts": {split: counts[split] for split in ("train", "validation", "test")},
        "split_policy": {
            "kind": (
                "frozen_metadata_split_plan"
                if split_plan_path is not None
                else "deterministic_group_isolation"
            ),
            "group_key": "content_group_id",
            "seed": config["seed"],
            "plan_path": (
                str(split_plan_path.resolve()) if split_plan_path is not None else None
            ),
        },
        "config": config,
        "usage_policy": _usage_policy(sources),
        "warnings": warnings,
    }
    write_json_atomic(output_dir / "manifest.json", manifest)
    return manifest


def validate_dataset(dataset_dir: Path) -> dict[str, Any]:
    manifest_path = dataset_dir / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    clips = [ClipRecord.from_dict(value) for value in read_jsonl(dataset_dir / "clips.jsonl")]
    errors: list[str] = []
    warnings = list(manifest.get("warnings") or [])
    seen_ids: set[str] = set()
    hashes_by_split: dict[str, set[str]] = {}
    for clip in clips:
        if clip.clip_id in seen_ids:
            errors.append(f"Duplicate clip_id: {clip.clip_id}")
        seen_ids.add(clip.clip_id)
        path = (dataset_dir / clip.local_path).resolve()
        try:
            path.relative_to(dataset_dir.resolve())
        except ValueError:
            errors.append(f"Clip escapes dataset root: {clip.local_path}")
            continue
        if not path.is_file():
            errors.append(f"Missing clip: {clip.local_path}")
            continue
        if sha256_file(path) != clip.sha256:
            errors.append(f"Digest mismatch: {clip.clip_id}")
        previous_splits = hashes_by_split.setdefault(clip.sha256, set())
        previous_splits.add(clip.split)
    leaked_groups = validate_group_isolation(
        (clip.content_group_id, clip.split) for clip in clips
    )
    if leaked_groups:
        errors.append(f"Content groups cross splits: {', '.join(leaked_groups)}")
    leaked_hashes = [digest for digest, splits in hashes_by_split.items() if len(splits) > 1]
    if leaked_hashes:
        errors.append(f"Identical clips cross splits: {len(leaked_hashes)}")
    counts = Counter(clip.split for clip in clips)
    report = {
        "schema_version": 1,
        "dataset_id": manifest.get("dataset_id"),
        "valid": not errors,
        "clip_count": len(clips),
        "split_counts": {split: counts[split] for split in ("train", "validation", "test")},
        "errors": errors,
        "warnings": sorted(set(warnings)),
    }
    write_json_atomic(dataset_dir / "validation-report.json", report)
    return report


def prepare_window_index(
    catalog_path: Path,
    output_dir: Path,
    config_path: Path,
    split_plan_path: Path | None = None,
    max_windows: int | None = None,
    allow_private_research: bool = False,
    candidate_role: str | None = None,
) -> dict[str, Any]:
    from .budget import video_token_rate

    config = json.loads(config_path.read_text(encoding="utf-8"))
    clip_config = config["clip"]
    duration = float(clip_config["duration_seconds"])
    stride = float(clip_config["stride_seconds"])
    minimum_relevance = float(config["data"]["minimum_relevance"])
    sources = _eligible_sources(
        catalog_path,
        minimum_relevance,
        allow_private_research,
        candidate_role,
    )
    if not sources:
        raise ValueError("No eligible, relevant, locally available sources in catalog")
    group_sizes = {
        source.content_group_id: max(1, round(source.duration_seconds or 1))
        for source in sources
    }
    if split_plan_path is not None:
        assignments = _load_split_plan(split_plan_path, set(group_sizes))
    else:
        assignments = assign_group_splits(
            group_sizes,
            {"train": 0.8, "validation": 0.1, "test": 0.1},
            int(config["seed"]),
        )
    candidates: list[tuple[SourceRecord, float]] = []
    for source in sources:
        available = float(source.duration_seconds or 0)
        start = 0.0
        while start + duration <= available + 1e-6:
            candidates.append((source, start))
            start += stride
    candidates.sort(key=lambda item: (item[0].source_id, item[1]))
    if max_windows is not None:
        candidates = _select_evenly(candidates, max_windows)
    tokens_per_window = round(video_token_rate(config) * duration)
    records: list[SourceWindowRecord] = []
    verified_sources: set[str] = set()
    for source, start in candidates:
        source_path = source.resolved_local_path(catalog_path)
        assert source_path is not None and source.sha256 is not None
        if source.source_id not in verified_sources:
            if sha256_file(source_path) != source.sha256:
                raise ValueError(f"Source digest mismatch: {source.source_id}")
            verified_sources.add(source.source_id)
        records.append(
            SourceWindowRecord(
                schema_version=1,
                window_id=stable_id(
                    "window", source.source_id, f"{start:.3f}", f"{duration:.3f}"
                ),
                source_id=source.source_id,
                content_group_id=source.content_group_id,
                split=assignments[source.content_group_id],  # type: ignore[arg-type]
                source_path=str(source_path),
                source_sha256=source.sha256,
                start_seconds=round(start, 3),
                end_seconds=round(start + duration, 3),
                duration_seconds=duration,
                token_count=tokens_per_window,
                rights_status=source.rights_status,
                map_name=source.map_name,
            )
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl_atomic(
        output_dir / "windows.jsonl", (record.as_dict() for record in records)
    )
    write_jsonl_atomic(
        output_dir / "sources.snapshot.jsonl", (source.as_dict() for source in sources)
    )
    counts = Counter(record.split for record in records)
    group_counts = Counter(
        {
            split: len(
                {
                    record.content_group_id
                    for record in records
                    if record.split == split
                }
            )
            for split in ("train", "validation", "test")
        }
    )
    unique_tokens_by_split = Counter({split: 0 for split in ("train", "validation", "test")})
    token_rate = video_token_rate(config)
    intervals: dict[tuple[str, str], list[tuple[float, float]]] = {}
    for record in records:
        intervals.setdefault((record.source_id, record.split), []).append(
            (record.start_seconds, record.end_seconds)
        )
    for (_, split), source_intervals in intervals.items():
        unique_tokens_by_split[split] += math.floor(
            _merged_interval_seconds(source_intervals) * token_rate
        )
    manifest = {
        "schema_version": 1,
        "dataset_id": stable_id(
            "gamejepa_window_dataset",
            config["experiment_id"],
            [(record.window_id, record.split) for record in records],
            length=20,
        ),
        "storage_kind": "source_window_index",
        "experiment_id": config["experiment_id"],
        "game": config["game"],
        "map": config["map"],
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_count": len(sources),
        "content_group_count": len(group_sizes),
        "window_count": len(records),
        "window_counts": {
            split: counts[split] for split in ("train", "validation", "test")
        },
        "content_group_counts": {
            split: group_counts[split]
            for split in ("train", "validation", "test")
        },
        "unique_video_tokens": {
            split: unique_tokens_by_split[split]
            for split in ("train", "validation", "test")
        },
        "token_count_note": (
            "Unique token counts use merged indexed time ranges. Overlapping windows are not double-counted."
        ),
        "split_policy": {
            "kind": (
                "frozen_metadata_split_plan"
                if split_plan_path is not None
                else "deterministic_group_isolation"
            ),
            "group_key": "content_group_id",
            "seed": config["seed"],
            "plan_path": (
                str(split_plan_path.resolve()) if split_plan_path is not None else None
            ),
        },
        "config": config,
        "usage_policy": _usage_policy(sources),
    }
    write_json_atomic(output_dir / "manifest.json", manifest)
    return manifest


def validate_window_index(dataset_dir: Path) -> dict[str, Any]:
    windows = [
        SourceWindowRecord.from_dict(value)
        for value in read_jsonl(dataset_dir / "windows.jsonl")
    ]
    errors: list[str] = []
    verified_sources: dict[str, str] = {}
    for window in windows:
        path = Path(window.source_path).resolve()
        if not path.is_file():
            errors.append(f"Missing source: {window.source_id}")
            continue
        previous = verified_sources.get(str(path))
        if previous is None:
            actual = sha256_file(path)
            verified_sources[str(path)] = actual
        else:
            actual = previous
        if actual != window.source_sha256:
            errors.append(f"Digest mismatch: {window.source_id}")
    leaked = validate_group_isolation(
        (window.content_group_id, window.split) for window in windows
    )
    if leaked:
        errors.append(f"Content groups cross splits: {', '.join(leaked)}")
    counts = Counter(window.split for window in windows)
    report = {
        "schema_version": 1,
        "storage_kind": "source_window_index",
        "valid": not errors,
        "source_count": len(verified_sources),
        "window_count": len(windows),
        "split_counts": {
            split: counts[split] for split in ("train", "validation", "test")
        },
        "errors": sorted(set(errors)),
    }
    write_json_atomic(dataset_dir / "validation-report.json", report)
    return report


def plan_catalog_splits(
    catalog_path: Path,
    output_path: Path,
    seed: int,
    minimum_relevance: float = 0.7,
) -> dict[str, Any]:
    sources = [
        source
        for source in load_catalog(catalog_path)
        if source.relevance_score >= minimum_relevance
    ]
    if not sources:
        raise ValueError("No relevant sources are available for split planning")
    group_sizes: dict[str, int] = {}
    for source in sources:
        estimated_clips = max(1, round((source.duration_seconds or 60) / 4))
        group_sizes[source.content_group_id] = (
            group_sizes.get(source.content_group_id, 0) + estimated_clips
        )
    assignments = assign_group_splits(
        group_sizes,
        {"train": 0.8, "validation": 0.1, "test": 0.1},
        seed,
    )
    counts = Counter(assignments[source.content_group_id] for source in sources)
    plan = {
        "schema_version": 1,
        "kind": "metadata_only_source_split_plan",
        "seed": seed,
        "minimum_relevance": minimum_relevance,
        "source_count": len(sources),
        "content_group_count": len(group_sizes),
        "split_source_counts": {
            split: counts[split] for split in ("train", "validation", "test")
        },
        "sources": [
            {
                "source_id": source.source_id,
                "content_group_id": source.content_group_id,
                "title": source.title,
                "webpage_url": source.webpage_url,
                "split": assignments[source.content_group_id],
                "rights_status": source.rights_status,
                "ready_for_download": (
                    source.rights_status in APPROVED_RIGHTS
                    and source.local_path is None
                ),
            }
            for source in sources
        ],
        "warning": (
            "This is a metadata plan, not a materialized dataset. Unknown-rights sources "
            "remain blocked from download and training."
        ),
    }
    write_json_atomic(output_path, plan)
    return plan


def _eligible_sources(
    catalog_path: Path,
    minimum_relevance: float,
    allow_private_research: bool = False,
    candidate_role: str | None = None,
) -> list[SourceRecord]:
    result: list[SourceRecord] = []
    fingerprints: dict[str, str] = {}
    allowed_rights = set(APPROVED_RIGHTS)
    if allow_private_research:
        allowed_rights.update(RESEARCH_ONLY_RIGHTS)
    for source in load_catalog(catalog_path):
        path = source.resolved_local_path(catalog_path)
        if (
            source.rights_status not in allowed_rights
            or source.relevance_score < minimum_relevance
            or path is None
            or not path.is_file()
            or (
                candidate_role is not None
                and source.metadata.get("candidate_role") != candidate_role
            )
        ):
            continue
        fingerprint = str(source.metadata.get("visual_fingerprint") or "")
        if fingerprint:
            prior_group = fingerprints.get(fingerprint)
            if prior_group is not None:
                source.content_group_id = prior_group
            else:
                fingerprints[fingerprint] = source.content_group_id
        result.append(source)
    return sorted(result, key=lambda item: item.source_id)


def _usage_policy(sources: list[SourceRecord]) -> dict[str, Any]:
    private_count = sum(
        source.rights_status in RESEARCH_ONLY_RIGHTS for source in sources
    )
    return {
        "private_research": private_count > 0,
        "private_research_source_count": private_count,
        "distribution_eligible": private_count == 0,
        "restriction": (
            "Local private research only; source media, derived datasets, and "
            "checkpoints must not be published."
            if private_count
            else None
        ),
    }


def _select_evenly(
    candidates: list[tuple[SourceRecord, float]], max_clips: int
) -> list[tuple[SourceRecord, float]]:
    if max_clips <= 0:
        raise ValueError("max_clips must be positive")
    if len(candidates) <= max_clips:
        return candidates
    if max_clips == 1:
        return [candidates[len(candidates) // 2]]
    indexes = {
        round(index * (len(candidates) - 1) / (max_clips - 1))
        for index in range(max_clips)
    }
    return [candidates[index] for index in sorted(indexes)]


def _load_split_plan(path: Path, required_groups: set[str]) -> dict[str, str]:
    value = json.loads(path.read_text(encoding="utf-8"))
    rows = value.get("sources")
    if not isinstance(rows, list):
        raise ValueError("Split plan must contain a sources array")
    assignments: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        group = row.get("content_group_id")
        split = row.get("split")
        if not isinstance(group, str) or split not in {"train", "validation", "test"}:
            raise ValueError("Split plan contains an invalid source row")
        previous = assignments.get(group)
        if previous is not None and previous != split:
            raise ValueError(f"Split plan leaks group {group} across splits")
        assignments[group] = split
    missing = sorted(required_groups - set(assignments))
    if missing:
        raise ValueError(f"Split plan is missing content groups: {', '.join(missing)}")
    return {group: assignments[group] for group in required_groups}


def _merged_interval_seconds(intervals: list[tuple[float, float]]) -> float:
    if not intervals:
        return 0
    ordered = sorted(intervals)
    total = 0.0
    start, end = ordered[0]
    for next_start, next_end in ordered[1:]:
        if next_start <= end:
            end = max(end, next_end)
        else:
            total += end - start
            start, end = next_start, next_end
    return total + end - start
