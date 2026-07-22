import json
from pathlib import Path

import pytest

from leviathan_game_jepa.preparation import _load_split_plan


def test_loads_frozen_group_plan(tmp_path: Path) -> None:
    path = tmp_path / "plan.json"
    path.write_text(
        json.dumps(
            {
                "sources": [
                    {"content_group_id": "a", "split": "train"},
                    {"content_group_id": "b", "split": "test"},
                ]
            }
        ),
        encoding="utf-8",
    )
    assert _load_split_plan(path, {"a", "b"}) == {"a": "train", "b": "test"}


def test_rejects_missing_group_in_frozen_plan(tmp_path: Path) -> None:
    path = tmp_path / "plan.json"
    path.write_text(
        json.dumps({"sources": [{"content_group_id": "a", "split": "train"}]}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="missing content groups"):
        _load_split_plan(path, {"a", "b"})
