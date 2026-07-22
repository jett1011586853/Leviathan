from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal


RightsStatus = Literal[
    "unknown",
    "private_research",
    "user_owned",
    "permissive",
    "explicit_permission",
    "public_domain",
]

Split = Literal["train", "validation", "test"]

APPROVED_RIGHTS: frozenset[str] = frozenset(
    {"user_owned", "permissive", "explicit_permission", "public_domain"}
)
RESEARCH_ONLY_RIGHTS: frozenset[str] = frozenset({"private_research"})
PROCESSABLE_RIGHTS: frozenset[str] = APPROVED_RIGHTS | RESEARCH_ONLY_RIGHTS


@dataclass(slots=True)
class SourceRecord:
    schema_version: int
    source_id: str
    provider: str
    webpage_url: str
    title: str
    uploader: str | None
    upload_date: str | None
    duration_seconds: float | None
    query: str | None
    game: str
    map_name: str
    relevance_score: float
    license: str | None
    rights_status: RightsStatus
    rights_evidence: str | None
    content_group_id: str
    local_path: str | None
    sha256: str | None
    width: int | None
    height: int | None
    fps: float | None
    discovered_at: str
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "SourceRecord":
        allowed = {item.name for item in cls.__dataclass_fields__.values()}
        unknown = set(value) - allowed
        if unknown:
            raise ValueError(f"Unknown source fields: {sorted(unknown)}")
        record = cls(**value)
        record.validate()
        return record

    def validate(self) -> None:
        if self.schema_version != 1:
            raise ValueError("Unsupported source schema version")
        if not self.source_id or not self.content_group_id:
            raise ValueError("source_id and content_group_id are required")
        if not 0 <= self.relevance_score <= 1:
            raise ValueError("relevance_score must be in [0, 1]")
        if self.rights_status not in PROCESSABLE_RIGHTS | {"unknown"}:
            raise ValueError(f"Invalid rights status: {self.rights_status}")
        if self.rights_status != "unknown" and not self.rights_evidence:
            raise ValueError("Approved rights require rights_evidence")

    def as_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)

    def resolved_local_path(self, catalog_path: Path) -> Path | None:
        if self.local_path is None:
            return None
        path = Path(self.local_path)
        if not path.is_absolute():
            path = catalog_path.parent / path
        return path.resolve()


@dataclass(slots=True)
class ClipRecord:
    schema_version: int
    clip_id: str
    source_id: str
    content_group_id: str
    split: Split
    local_path: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    sha256: str
    width: int
    height: int
    fps: float
    frame_count: int
    rights_status: RightsStatus
    map_name: str

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "ClipRecord":
        record = cls(**value)
        record.validate()
        return record

    def validate(self) -> None:
        if self.schema_version != 1:
            raise ValueError("Unsupported clip schema version")
        if self.split not in {"train", "validation", "test"}:
            raise ValueError(f"Invalid split: {self.split}")
        if self.duration_seconds <= 0 or self.end_seconds <= self.start_seconds:
            raise ValueError("Clip duration is invalid")
        if len(self.sha256) != 64:
            raise ValueError("Clip SHA-256 is invalid")
        if self.rights_status not in PROCESSABLE_RIGHTS:
            raise ValueError("Clip source is not approved for local processing")

    def as_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)


@dataclass(slots=True)
class SourceWindowRecord:
    schema_version: int
    window_id: str
    source_id: str
    content_group_id: str
    split: Split
    source_path: str
    source_sha256: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    token_count: int
    rights_status: RightsStatus
    map_name: str

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "SourceWindowRecord":
        record = cls(**value)
        record.validate()
        return record

    def validate(self) -> None:
        if self.schema_version != 1:
            raise ValueError("Unsupported source-window schema version")
        if self.split not in {"train", "validation", "test"}:
            raise ValueError(f"Invalid split: {self.split}")
        if self.duration_seconds <= 0 or self.end_seconds <= self.start_seconds:
            raise ValueError("Source window duration is invalid")
        if self.token_count <= 0:
            raise ValueError("Source window token_count must be positive")
        if len(self.source_sha256) != 64:
            raise ValueError("Source SHA-256 is invalid")
        if self.rights_status not in PROCESSABLE_RIGHTS:
            raise ValueError("Source window is not approved for training")

    def as_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)


def relative_or_absolute(path: Path, parent: Path) -> str:
    try:
        return path.resolve().relative_to(parent.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())
