import pytest

from leviathan_game_jepa.records import SourceRecord


def test_source_rejects_approved_rights_without_evidence() -> None:
    value = {
        "schema_version": 1,
        "source_id": "source_x",
        "provider": "web",
        "webpage_url": "https://example.invalid",
        "title": "example",
        "uploader": None,
        "upload_date": None,
        "duration_seconds": None,
        "query": None,
        "game": "逆战：未来",
        "map_name": "丛林魅影",
        "relevance_score": 1.0,
        "license": None,
        "rights_status": "permissive",
        "rights_evidence": None,
        "content_group_id": "source_x",
        "local_path": None,
        "sha256": None,
        "width": None,
        "height": None,
        "fps": None,
        "discovered_at": "2026-07-18T00:00:00Z",
        "metadata": {},
    }
    with pytest.raises(ValueError, match="evidence"):
        SourceRecord.from_dict(value)
