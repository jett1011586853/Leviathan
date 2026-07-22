from leviathan_game_jepa.splitting import assign_group_splits, validate_group_isolation


def test_group_split_is_deterministic_and_isolated() -> None:
    groups = {f"source-{index}": index + 2 for index in range(12)}
    ratios = {"train": 0.8, "validation": 0.1, "test": 0.1}
    first = assign_group_splits(groups, ratios, seed=42)
    second = assign_group_splits(groups, ratios, seed=42)

    assert first == second
    assert set(first) == set(groups)
    assert set(first.values()) == {"train", "validation", "test"}
    assert validate_group_isolation((group, split) for group, split in first.items()) == []


def test_single_group_stays_in_one_split() -> None:
    result = assign_group_splits(
        {"one-session": 100},
        {"train": 0.8, "validation": 0.1, "test": 0.1},
        seed=1,
    )
    assert result == {"one-session": "train"}


def test_detects_group_leakage() -> None:
    assert validate_group_isolation(
        [("same-video", "train"), ("same-video", "test")]
    ) == ["same-video"]
