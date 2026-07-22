from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from .io_utils import read_jsonl, write_json_atomic


ActionSource = Literal["human", "policy", "pseudo"]

ACTION_VECTOR_FIELDS = (
    "move_forward",
    "move_left",
    "move_backward",
    "move_right",
    "mouse_dx",
    "mouse_dy",
    "fire",
    "aim",
    "reload",
    "interact",
    "jump",
    "sprint",
)

MINIMUM_CAUSAL_ACTION_SAMPLES = 128
MINIMUM_CAUSAL_FRAME_COUNT = 32
MINIMUM_FRAME_MATCH_RATIO = 0.95


@dataclass(frozen=True, slots=True)
class ActionSample:
    schema_version: int
    session_id: str
    episode_id: str
    timestamp_ns: int
    frame_sequence: int
    delta_seconds: float
    source: ActionSource
    move_forward: float
    move_left: float
    move_backward: float
    move_right: float
    mouse_dx: float
    mouse_dy: float
    fire: float
    aim: float
    reload: float
    interact: float
    jump: float
    sprint: float
    takeover: bool = False

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ActionSample":
        value = dict(value)
        if "timestamp_ns" in value:
            value["timestamp_ns"] = int(value["timestamp_ns"])
        allowed = {field.name for field in cls.__dataclass_fields__.values()}
        unknown = set(value) - allowed
        if unknown:
            raise ValueError(f"Unknown action fields: {sorted(unknown)}")
        sample = cls(**value)
        sample.validate()
        return sample

    def validate(self) -> None:
        if self.schema_version != 1:
            raise ValueError("Unsupported action schema version")
        if not self.session_id or not self.episode_id:
            raise ValueError("session_id and episode_id are required")
        if self.timestamp_ns <= 0 or self.frame_sequence < 0:
            raise ValueError("Action timestamp/frame sequence is invalid")
        if not 0 < self.delta_seconds <= 1:
            raise ValueError("delta_seconds must be in (0, 1]")
        if self.source not in {"human", "policy", "pseudo"}:
            raise ValueError(f"Invalid action source: {self.source}")
        for field in ACTION_VECTOR_FIELDS:
            value = float(getattr(self, field))
            if not -1 <= value <= 1:
                raise ValueError(f"{field} must be normalized to [-1, 1]")

    def vector(self) -> list[float]:
        self.validate()
        return [float(getattr(self, field)) for field in ACTION_VECTOR_FIELDS]

    def as_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)


def validate_action_trajectory(path: Path, output_path: Path | None = None) -> dict[str, Any]:
    samples = [ActionSample.from_dict(value) for value in read_jsonl(path)]
    errors: list[str] = []
    previous_by_episode: dict[str, ActionSample] = {}
    for sample in samples:
        previous = previous_by_episode.get(sample.episode_id)
        if previous is not None:
            if sample.timestamp_ns <= previous.timestamp_ns:
                errors.append(
                    f"Non-monotonic timestamp in episode {sample.episode_id}"
                )
            if sample.frame_sequence < previous.frame_sequence:
                errors.append(
                    f"Frame sequence moved backwards in episode {sample.episode_id}"
                )
        previous_by_episode[sample.episode_id] = sample
    sources = Counter(sample.source for sample in samples)
    report = {
        "schema_version": 1,
        "valid": not errors,
        "sample_count": len(samples),
        "session_count": len({sample.session_id for sample in samples}),
        "episode_count": len({sample.episode_id for sample in samples}),
        "source_counts": dict(sorted(sources.items())),
        "takeover_count": sum(sample.takeover for sample in samples),
        "eligible_for_causal_test_truth": sum(
            sample.source in {"human", "policy"} and not sample.takeover
            for sample in samples
        ),
        "pseudo_count": sources["pseudo"],
        "errors": sorted(set(errors)),
    }
    if output_path is not None:
        write_json_atomic(output_path, report)
    return report


def audit_action_session(
    session_dir: Path, output_path: Path | None = None
) -> dict[str, Any]:
    session_dir = session_dir.resolve()
    actions_path = session_dir / "actions.jsonl"
    frames_path = session_dir / "frames.index.jsonl"
    trajectory = validate_action_trajectory(actions_path)
    samples = [ActionSample.from_dict(value) for value in read_jsonl(actions_path)]
    frames = read_jsonl(frames_path)
    frame_sequences = {
        int(frame["sequence"])
        for frame in frames
        if isinstance(frame.get("sequence"), int)
        and int(frame["sequence"]) >= 0
    }
    causal = [
        sample
        for sample in samples
        if sample.source in {"human", "policy"} and not sample.takeover
    ]
    matched = [sample for sample in causal if sample.frame_sequence in frame_sequences]
    match_ratio = len(matched) / len(causal) if causal else 0.0
    causal_frames = {sample.frame_sequence for sample in matched}
    reasons = []
    if not trajectory["valid"]:
        reasons.append("action trajectory validation failed")
    if len(causal) < MINIMUM_CAUSAL_ACTION_SAMPLES:
        reasons.append(
            f"causal action samples {len(causal)} < {MINIMUM_CAUSAL_ACTION_SAMPLES}"
        )
    if len(causal_frames) < MINIMUM_CAUSAL_FRAME_COUNT:
        reasons.append(
            f"matched causal frames {len(causal_frames)} < {MINIMUM_CAUSAL_FRAME_COUNT}"
        )
    if match_ratio < MINIMUM_FRAME_MATCH_RATIO:
        reasons.append(
            f"causal frame match ratio {match_ratio:.4f} < {MINIMUM_FRAME_MATCH_RATIO:.2f}"
        )
    report = {
        "schema_version": 1,
        "session_dir": str(session_dir),
        "actions_path": str(actions_path),
        "frames_path": str(frames_path),
        "trajectory": trajectory,
        "frame_count": len(frames),
        "unique_frame_sequences": len(frame_sequences),
        "causal_action_samples": len(causal),
        "pseudo_action_samples": sum(sample.source == "pseudo" for sample in samples),
        "matched_causal_action_samples": len(matched),
        "matched_causal_frame_count": len(causal_frames),
        "causal_frame_match_ratio": round(match_ratio, 8),
        "eligible_for_dynamics_training": not reasons,
        "ineligible_reasons": reasons,
        "thresholds": {
            "minimum_causal_action_samples": MINIMUM_CAUSAL_ACTION_SAMPLES,
            "minimum_causal_frame_count": MINIMUM_CAUSAL_FRAME_COUNT,
            "minimum_frame_match_ratio": MINIMUM_FRAME_MATCH_RATIO,
        },
    }
    if output_path is not None:
        write_json_atomic(output_path, report)
    return report
