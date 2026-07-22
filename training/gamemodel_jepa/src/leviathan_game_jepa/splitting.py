from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Iterable


SPLITS = ("train", "validation", "test")


def assign_group_splits(
    group_sizes: dict[str, int],
    ratios: dict[str, float],
    seed: int,
) -> dict[str, str]:
    if not group_sizes:
        return {}
    _validate_ratios(ratios)
    for group, size in group_sizes.items():
        if not group or size <= 0:
            raise ValueError("Group names must be non-empty and sizes positive")

    ordered = sorted(
        group_sizes,
        key=lambda group: (
            -group_sizes[group],
            hashlib.sha256(f"{seed}:{group}".encode()).hexdigest(),
        ),
    )
    total = sum(group_sizes.values())
    targets = {split: total * ratios[split] for split in SPLITS}
    assigned_counts = Counter({split: 0 for split in SPLITS})
    assignments: dict[str, str] = {}

    # With at least three independent sources, reserve one group for each split.
    if len(ordered) >= 3:
        reserved = sorted(
            ("validation", "test"),
            key=lambda split: hashlib.sha256(f"{seed}:{split}".encode()).hexdigest(),
        )
        for split in reserved:
            group = ordered.pop()
            assignments[group] = split
            assigned_counts[split] += group_sizes[group]

    for group in ordered:
        size = group_sizes[group]
        split = max(
            SPLITS,
            key=lambda candidate: (
                targets[candidate] - assigned_counts[candidate],
                ratios[candidate],
                candidate == "train",
            ),
        )
        assignments[group] = split
        assigned_counts[split] += size
    return assignments


def validate_group_isolation(rows: Iterable[tuple[str, str]]) -> list[str]:
    splits_by_group: dict[str, set[str]] = {}
    for group, split in rows:
        splits_by_group.setdefault(group, set()).add(split)
    return sorted(group for group, splits in splits_by_group.items() if len(splits) > 1)


def _validate_ratios(ratios: dict[str, float]) -> None:
    if set(ratios) != set(SPLITS):
        raise ValueError(f"Ratios must define exactly {SPLITS}")
    if any(ratios[split] < 0 for split in SPLITS):
        raise ValueError("Split ratios cannot be negative")
    if abs(sum(ratios.values()) - 1.0) > 1e-6:
        raise ValueError("Split ratios must sum to 1")
