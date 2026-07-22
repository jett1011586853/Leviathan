from pathlib import Path

import pytest

import leviathan_game_jepa.catalog as catalog_module
from leviathan_game_jepa.cli import build_parser
from leviathan_game_jepa.catalog import (
    attach_downloaded_video,
    browser_cookie_args,
    relevance_score,
    save_catalog,
    set_source_rights,
    validate_media_url,
)
from leviathan_game_jepa.media import VideoProbe
from leviathan_game_jepa.preparation import _eligible_sources
from leviathan_game_jepa.records import SourceRecord


def source() -> SourceRecord:
    return SourceRecord(
        schema_version=1,
        source_id="source_test",
        provider="bilibili",
        webpage_url="https://example.invalid/video",
        title="逆战未来 丛林魅影 实机",
        uploader="tester",
        upload_date=None,
        duration_seconds=10,
        query="逆战未来 丛林魅影",
        game="逆战：未来",
        map_name="丛林魅影",
        relevance_score=1,
        license=None,
        rights_status="unknown",
        rights_evidence=None,
        content_group_id="source_test",
        local_path=None,
        sha256=None,
        width=None,
        height=None,
        fps=None,
        discovered_at="2026-07-18T00:00:00Z",
    )


def test_relevance_requires_map_and_game_names() -> None:
    assert relevance_score("逆战未来 丛林魅影", "") == 1.0
    assert relevance_score("逆戰未來 叢林魅影", "") == 1.0
    assert relevance_score("丛林魅影", "") == 0.7
    assert relevance_score("unrelated", "") == 0.0


def test_rights_approval_requires_evidence(tmp_path: Path) -> None:
    catalog = tmp_path / "sources.jsonl"
    save_catalog(catalog, [source()])
    with pytest.raises(ValueError, match="evidence"):
        set_source_rights(catalog, "source_test", "permissive", "")


def test_rights_review_is_persisted(tmp_path: Path) -> None:
    catalog = tmp_path / "sources.jsonl"
    save_catalog(catalog, [source()])
    reviewed = set_source_rights(
        catalog,
        "source_test",
        "explicit_permission",
        "Creator permission archived under review ticket 17.",
    )
    assert reviewed.rights_status == "explicit_permission"


def test_browser_session_uses_yt_dlp_cookie_store_without_raw_cookie() -> None:
    assert browser_cookie_args("Edge") == ["--cookies-from-browser", "edge"]
    with pytest.raises(ValueError, match="Unsupported cookie browser"):
        browser_cookie_args("edge:Profile 1")


def test_access_probe_restricts_media_hosts() -> None:
    assert (
        validate_media_url("https://www.bilibili.com/video/BV1example")
        == "https://www.bilibili.com/video/BV1example"
    )
    with pytest.raises(ValueError, match="HTTPS Bilibili or YouTube"):
        validate_media_url("file:///C:/private/cookies.txt")


def test_downloaded_attachment_preserves_unknown_rights(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = tmp_path / "sources.jsonl"
    record = source()
    record.duration_seconds = 10.0
    save_catalog(catalog, [record])
    video = tmp_path / "candidate.mp4"
    video.write_bytes(b"candidate-video")
    monkeypatch.setattr(
        catalog_module,
        "probe_video",
        lambda _: VideoProbe(10.5, 1920, 1080, 30.0, 315),
    )
    monkeypatch.setattr(catalog_module, "video_fingerprint", lambda _: "f" * 64)

    attached = attach_downloaded_video(
        catalog, "source_test", video, "continuous_gameplay"
    )

    assert attached.rights_status == "unknown"
    assert attached.local_path is not None
    assert attached.sha256 is not None
    assert attached.metadata["candidate_role"] == "continuous_gameplay"


def test_downloaded_attachment_rejects_wrong_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = tmp_path / "sources.jsonl"
    record = source()
    record.duration_seconds = 10.0
    save_catalog(catalog, [record])
    video = tmp_path / "wrong.mp4"
    video.write_bytes(b"wrong-video")
    monkeypatch.setattr(
        catalog_module,
        "probe_video",
        lambda _: VideoProbe(30.0, 1920, 1080, 30.0, 900),
    )

    with pytest.raises(ValueError, match="does not match source metadata"):
        attach_downloaded_video(
            catalog, "source_test", video, "continuous_gameplay"
        )


def test_attach_downloaded_cli_is_registered() -> None:
    args = build_parser().parse_args(
        [
            "attach-downloaded",
            "--catalog",
            "sources.jsonl",
            "--source-id",
            "source_test",
            "--video",
            "candidate.mp4",
            "--candidate-role",
            "continuous_gameplay",
        ]
    )
    assert args.command == "attach-downloaded"


def test_private_research_requires_explicit_preparation_opt_in(tmp_path: Path) -> None:
    catalog = tmp_path / "sources.jsonl"
    video = tmp_path / "candidate.mp4"
    video.write_bytes(b"local-research-video")
    record = source()
    record.local_path = str(video)
    record.rights_status = "private_research"
    record.rights_evidence = "User authorized local-only private research."
    record.metadata["candidate_role"] = "continuous_gameplay"
    save_catalog(catalog, [record])

    assert _eligible_sources(catalog, 1.0) == []
    eligible = _eligible_sources(
        catalog,
        1.0,
        allow_private_research=True,
        candidate_role="continuous_gameplay",
    )
    assert [item.source_id for item in eligible] == ["source_test"]


def test_prepare_index_cli_accepts_private_research_scope() -> None:
    args = build_parser().parse_args(
        [
            "prepare-index",
            "--catalog",
            "sources.jsonl",
            "--output",
            "dataset",
            "--config",
            "config.json",
            "--allow-private-research",
            "--candidate-role",
            "continuous_gameplay",
        ]
    )
    assert args.allow_private_research is True
    assert args.candidate_role == "continuous_gameplay"


def test_evaluate_jepa_cli_defaults_to_validation() -> None:
    args = build_parser().parse_args(
        [
            "evaluate-jepa",
            "--dataset",
            "dataset",
            "--config",
            "config.json",
            "--checkpoint",
            "checkpoint.pt",
            "--output",
            "evaluation.json",
        ]
    )
    assert args.split == "validation"
    assert args.max_batches == 32


def test_smoke_dynamics_cli_defaults_to_40_steps() -> None:
    args = build_parser().parse_args(
        [
            "smoke-dynamics",
            "--config",
            "config.json",
            "--output",
            "run",
        ]
    )

    assert args.steps == 40
