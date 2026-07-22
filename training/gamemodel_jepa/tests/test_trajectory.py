from pathlib import Path

from leviathan_game_jepa.io_utils import write_jsonl_atomic
from leviathan_game_jepa.trajectory import (
    ACTION_VECTOR_FIELDS,
    audit_action_session,
    validate_action_trajectory,
)


def action(timestamp: int, sequence: int, source: str = "human") -> dict:
    value = {
        "schema_version": 1,
        "session_id": "session-1",
        "episode_id": "episode-1",
        "timestamp_ns": timestamp,
        "frame_sequence": sequence,
        "delta_seconds": 1 / 60,
        "source": source,
        "takeover": False,
    }
    value.update({field: 0.0 for field in ACTION_VECTOR_FIELDS})
    return value


def test_validates_monotonic_action_trajectory(tmp_path: Path) -> None:
    path = tmp_path / "actions.jsonl"
    write_jsonl_atomic(path, [action(100, 1), action(200, 2, "pseudo")])
    report = validate_action_trajectory(path)
    assert report["valid"] is True
    assert report["sample_count"] == 2
    assert report["pseudo_count"] == 1
    assert report["eligible_for_causal_test_truth"] == 1


def test_rejects_non_monotonic_action_trajectory(tmp_path: Path) -> None:
    path = tmp_path / "actions.jsonl"
    write_jsonl_atomic(path, [action(200, 2), action(100, 1)])
    report = validate_action_trajectory(path)
    assert report["valid"] is False
    assert len(report["errors"]) == 2


def test_accepts_javascript_safe_string_timestamp(tmp_path: Path) -> None:
    path = tmp_path / "actions.jsonl"
    sample = action(100, 1)
    sample["timestamp_ns"] = "1700000000000000000"
    write_jsonl_atomic(path, [sample])

    report = validate_action_trajectory(path)

    assert report["valid"] is True


def test_action_session_gate_accepts_aligned_causal_samples(tmp_path: Path) -> None:
    session = tmp_path / "session"
    session.mkdir()
    actions = [action(index + 1, index // 4) for index in range(128)]
    frames = [
        {"schemaVersion": 1, "sequence": sequence, "capturedAt": sequence * 50}
        for sequence in range(32)
    ]
    write_jsonl_atomic(session / "actions.jsonl", actions)
    write_jsonl_atomic(session / "frames.index.jsonl", frames)

    report = audit_action_session(session)

    assert report["eligible_for_dynamics_training"] is True
    assert report["causal_frame_match_ratio"] == 1


def test_action_session_gate_rejects_pseudo_only_session(tmp_path: Path) -> None:
    session = tmp_path / "session"
    session.mkdir()
    write_jsonl_atomic(session / "actions.jsonl", [action(1, 0, "pseudo")])
    write_jsonl_atomic(
        session / "frames.index.jsonl",
        [{"schemaVersion": 1, "sequence": 0, "capturedAt": 0}],
    )

    report = audit_action_session(session)

    assert report["eligible_for_dynamics_training"] is False
    assert report["causal_action_samples"] == 0
