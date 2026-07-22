import json
from pathlib import Path

from leviathan_game_jepa.budget import estimate_token_budget, video_token_rate
from leviathan_game_jepa.training import _enforce_formal_data_gate


def config() -> dict:
    return {
        "clip": {"frames": 8, "duration_seconds": 4, "width": 112, "height": 112},
        "model": {"tubelet_size": 2, "patch_size": 16},
        "data": {
            "token_budget": {
                "train": 50_000_000,
                "validation": 6_250_000,
                "test": 6_250_000,
                "minimum_content_groups": {
                    "train": 50,
                    "validation": 10,
                    "test": 10,
                },
                "maximum_train_group_fraction": 0.02,
            }
        },
    }


def test_video_token_rate_is_fixed_by_tokenizer() -> None:
    assert video_token_rate(config()) == 49


def test_training_budget_requires_more_than_283_unique_hours(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config()), encoding="utf-8")
    report = estimate_token_budget(path)
    assert report["targets"]["train"]["tokens"] == 50_000_000
    assert report["targets"]["train"]["minimum_unique_hours"] > 283
    assert report["total"]["tokens"] == 62_500_000


def test_formal_training_rejects_under_budget_dataset() -> None:
    manifest = {
        "unique_video_tokens": {"train": 1, "validation": 0, "test": 0},
        "content_group_counts": {"train": 1, "validation": 0, "test": 0},
    }
    try:
        _enforce_formal_data_gate(manifest, config())
    except ValueError as error:
        assert "Formal data gate failed" in str(error)
    else:
        raise AssertionError("Expected formal data gate to reject undersized data")


def test_formal_training_accepts_complete_budget() -> None:
    manifest = {
        "unique_video_tokens": {
            "train": 50_000_000,
            "validation": 6_250_000,
            "test": 6_250_000,
        },
        "content_group_counts": {"train": 50, "validation": 10, "test": 10},
    }
    _enforce_formal_data_gate(manifest, config())
