from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .io_utils import read_jsonl, sha256_file, stable_id, write_jsonl_atomic
from .media import probe_video, video_fingerprint
from .records import (
    APPROVED_RIGHTS,
    PROCESSABLE_RIGHTS,
    SourceRecord,
    relative_or_absolute,
)


DEFAULT_QUERY = "逆战未来 丛林魅影"
GAME_NAME = "逆战：未来"
MAP_NAME = "丛林魅影"

SUPPORTED_COOKIE_BROWSERS = frozenset({"brave", "chrome", "edge", "firefox"})
SUPPORTED_MEDIA_HOSTS = frozenset(
    {
        "bilibili.com",
        "www.bilibili.com",
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
    }
)
CANDIDATE_ROLES = frozenset(
    {"continuous_gameplay", "visual_reference", "excluded"}
)


def load_catalog(path: Path) -> list[SourceRecord]:
    records = [SourceRecord.from_dict(value) for value in read_jsonl(path)]
    seen: set[str] = set()
    for record in records:
        if record.source_id in seen:
            raise ValueError(f"Duplicate source_id in catalog: {record.source_id}")
        seen.add(record.source_id)
    return records


def save_catalog(path: Path, records: list[SourceRecord]) -> None:
    ordered = sorted(records, key=lambda item: item.source_id)
    write_jsonl_atomic(path, (record.as_dict() for record in ordered))


def register_local_video(
    catalog_path: Path,
    video_path: Path,
    title: str,
    rights_evidence: str,
) -> SourceRecord:
    video_path = video_path.resolve()
    if not video_path.is_file():
        raise FileNotFoundError(video_path)
    digest = sha256_file(video_path)
    probe = probe_video(video_path)
    source_id = stable_id("source", "local", digest)
    fingerprint = video_fingerprint(video_path)
    record = SourceRecord(
        schema_version=1,
        source_id=source_id,
        provider="local",
        webpage_url=f"local://{digest}",
        title=title,
        uploader=None,
        upload_date=None,
        duration_seconds=probe.duration_seconds,
        query=None,
        game=GAME_NAME,
        map_name=MAP_NAME,
        relevance_score=1.0,
        license=None,
        rights_status="user_owned",
        rights_evidence=rights_evidence,
        content_group_id=source_id,
        local_path=relative_or_absolute(video_path, catalog_path.parent),
        sha256=digest,
        width=probe.width,
        height=probe.height,
        fps=probe.fps,
        discovered_at=utc_now(),
        metadata={"visual_fingerprint": fingerprint},
    )
    records = load_catalog(catalog_path)
    merged = {item.source_id: item for item in records}
    merged[source_id] = record
    save_catalog(catalog_path, list(merged.values()))
    return record


def attach_downloaded_video(
    catalog_path: Path,
    source_id: str,
    video_path: Path,
    candidate_role: str,
) -> SourceRecord:
    """Attach a downloaded file to known source metadata without approving rights."""
    if candidate_role not in CANDIDATE_ROLES:
        choices = ", ".join(sorted(CANDIDATE_ROLES))
        raise ValueError(f"Invalid candidate role. Choose one of: {choices}")
    video_path = video_path.resolve()
    if not video_path.is_file():
        raise FileNotFoundError(video_path)
    records = load_catalog(catalog_path)
    record = next((item for item in records if item.source_id == source_id), None)
    if record is None:
        raise KeyError(f"Unknown source: {source_id}")
    if record.provider == "local":
        raise ValueError("Locally owned captures must use register-local")

    probe = probe_video(video_path)
    if record.duration_seconds is not None:
        duration_delta = abs(probe.duration_seconds - record.duration_seconds)
        tolerance = max(3.0, record.duration_seconds * 0.02)
        if duration_delta > tolerance:
            raise ValueError(
                "Downloaded file duration does not match source metadata: "
                f"delta={duration_delta:.2f}s tolerance={tolerance:.2f}s"
            )
    else:
        duration_delta = None

    digest = sha256_file(video_path)
    duplicate = next(
        (
            item
            for item in records
            if item.source_id != source_id and item.sha256 == digest
        ),
        None,
    )
    if duplicate is not None:
        raise ValueError(
            f"Downloaded file is already attached to source {duplicate.source_id}"
        )

    record.local_path = relative_or_absolute(video_path, catalog_path.parent)
    record.sha256 = digest
    record.duration_seconds = probe.duration_seconds
    record.width = probe.width
    record.height = probe.height
    record.fps = probe.fps
    record.metadata = {
        **record.metadata,
        "candidate_role": candidate_role,
        "attachment_verified_at": utc_now(),
        "attachment_duration_delta_seconds": (
            round(duration_delta, 3) if duration_delta is not None else None
        ),
        "visual_fingerprint": video_fingerprint(video_path),
    }
    save_catalog(catalog_path, records)
    return record


def discover_public_sources(
    catalog_path: Path,
    provider: str,
    limit: int,
    query: str = DEFAULT_QUERY,
    cookies_from_browser: str | None = None,
) -> list[SourceRecord]:
    executable = shutil.which("yt-dlp")
    if executable is None:
        raise RuntimeError("yt-dlp is required for metadata discovery")
    if provider == "bilibili":
        search = f"bilisearch{limit}:{query}"
    elif provider == "youtube":
        search = f"ytsearch{limit}:{query}"
    else:
        raise ValueError("provider must be 'bilibili' or 'youtube'")
    command = [
        executable,
        "--ignore-config",
        "--dump-single-json",
        "--flat-playlist",
        "--skip-download",
        "--no-warnings",
        "--no-update",
        *browser_cookie_args(cookies_from_browser),
        search,
    ]
    payload: dict[str, Any] | None = None
    last_error = ""
    for attempt in range(3):
        process = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        last_error = process.stderr.strip()
        try:
            candidate = json.loads(process.stdout)
        except json.JSONDecodeError:
            candidate = None
        if isinstance(candidate, dict) and isinstance(candidate.get("entries"), list):
            candidate_entries = candidate["entries"]
            if any(isinstance(entry, dict) for entry in candidate_entries):
                payload = candidate
                break
        if attempt < 2:
            time.sleep(1.5 * (attempt + 1))
    if payload is None:
        raise RuntimeError(f"yt-dlp metadata discovery failed: {last_error}")
    entries = payload.get("entries") or []
    discovered: list[SourceRecord] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if provider == "bilibili":
            entry = hydrate_bilibili_entry(entry)
        elif provider == "youtube":
            entry = hydrate_youtube_entry(executable, entry, cookies_from_browser)
        url = canonical_entry_url(provider, entry)
        title = str(entry.get("title") or entry.get("id") or "untitled")
        description = str(entry.get("description") or "")
        score = relevance_score(title, description)
        license_name = optional_text(entry.get("license"))
        rights_status, rights_evidence = infer_platform_rights(license_name)
        source_id = stable_id("source", provider, url)
        discovered.append(
            SourceRecord(
                schema_version=1,
                source_id=source_id,
                provider=provider,
                webpage_url=url,
                title=title,
                uploader=optional_text(entry.get("uploader") or entry.get("channel")),
                upload_date=optional_text(entry.get("upload_date")),
                duration_seconds=optional_float(entry.get("duration")),
                query=query,
                game=GAME_NAME,
                map_name=MAP_NAME,
                relevance_score=score,
                license=license_name,
                rights_status=rights_status,
                rights_evidence=rights_evidence,
                content_group_id=source_id,
                local_path=None,
                sha256=None,
                width=optional_int(entry.get("width")),
                height=optional_int(entry.get("height")),
                fps=optional_float(entry.get("fps")),
                discovered_at=utc_now(),
                metadata={
                    "extractor": optional_text(entry.get("extractor")),
                    "id": optional_text(entry.get("id")),
                    "view_count": optional_int(entry.get("view_count")),
                    "bilibili_copyright_code": optional_int(
                        entry.get("bilibili_copyright_code")
                    ),
                    "bilibili_no_reprint": optional_int(
                        entry.get("bilibili_no_reprint")
                    ),
                },
            )
        )

    existing = {record.source_id: record for record in load_catalog(catalog_path)}
    for record in discovered:
        previous = existing.get(record.source_id)
        if previous is not None:
            record.rights_status = previous.rights_status
            record.rights_evidence = previous.rights_evidence
            record.local_path = previous.local_path
            record.sha256 = previous.sha256
            record.content_group_id = previous.content_group_id
            record.metadata = {**record.metadata, **previous.metadata}
        existing[record.source_id] = record
    save_catalog(catalog_path, list(existing.values()))
    return discovered


def set_source_rights(
    catalog_path: Path,
    source_id: str,
    status: str,
    evidence: str,
) -> SourceRecord:
    if status not in PROCESSABLE_RIGHTS | {"unknown"}:
        raise ValueError(f"Invalid rights status: {status}")
    if status != "unknown" and not evidence.strip():
        raise ValueError("Approved rights require non-empty evidence")
    records = load_catalog(catalog_path)
    record = next((item for item in records if item.source_id == source_id), None)
    if record is None:
        raise KeyError(f"Unknown source: {source_id}")
    record.rights_status = status  # type: ignore[assignment]
    record.rights_evidence = evidence.strip() or None
    save_catalog(catalog_path, records)
    return record


def download_source(
    catalog_path: Path,
    source_id: str,
    output_dir: Path,
    cookies_from_browser: str | None = None,
) -> SourceRecord:
    records = load_catalog(catalog_path)
    record = next((item for item in records if item.source_id == source_id), None)
    if record is None:
        raise KeyError(f"Unknown source: {source_id}")
    if record.provider == "local":
        raise ValueError("Local sources are already registered")
    if record.rights_status not in APPROVED_RIGHTS:
        raise PermissionError(
            "Download blocked: review the source and record explicit rights evidence first"
        )
    executable = shutil.which("yt-dlp")
    if executable is None:
        raise RuntimeError("yt-dlp is required for approved downloads")
    output_dir.mkdir(parents=True, exist_ok=True)
    template = str(output_dir / f"{record.source_id}.%(ext)s")
    subprocess.run(
        [
            executable,
            "--ignore-config",
            "--no-playlist",
            "--no-write-comments",
            "--no-update",
            "--restrict-filenames",
            *browser_cookie_args(cookies_from_browser),
            "-o",
            template,
            record.webpage_url,
        ],
        check=True,
    )
    candidates = [
        path
        for path in output_dir.glob(f"{record.source_id}.*")
        if path.suffix.lower() not in {".json", ".jpg", ".jpeg", ".png", ".webp"}
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one downloaded video, found {len(candidates)}")
    video_path = candidates[0].resolve()
    probe = probe_video(video_path)
    record.local_path = relative_or_absolute(video_path, catalog_path.parent)
    record.sha256 = sha256_file(video_path)
    record.duration_seconds = probe.duration_seconds
    record.width = probe.width
    record.height = probe.height
    record.fps = probe.fps
    record.metadata["visual_fingerprint"] = video_fingerprint(video_path)
    save_catalog(catalog_path, records)
    return record


def probe_source_access(
    url: str,
    cookies_from_browser: str | None = None,
) -> dict[str, Any]:
    """Inspect available media formats without downloading or exposing credentials."""
    validated_url = validate_media_url(url)
    executable = shutil.which("yt-dlp")
    if executable is None:
        raise RuntimeError("yt-dlp is required for access probes")
    process = subprocess.run(
        [
            executable,
            "--ignore-config",
            "--dump-single-json",
            "--skip-download",
            "--no-warnings",
            "--no-update",
            "--no-playlist",
            *browser_cookie_args(cookies_from_browser),
            validated_url,
        ],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    if process.returncode != 0:
        detail = safe_process_error(process.stderr)
        raise RuntimeError(f"yt-dlp access probe failed: {detail}")
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("yt-dlp access probe returned invalid metadata") from error
    if not isinstance(payload, dict):
        raise RuntimeError("yt-dlp access probe returned invalid metadata")
    formats = payload.get("formats")
    available_formats = [item for item in formats or [] if isinstance(item, dict)]
    heights = [
        height
        for item in available_formats
        if (height := optional_int(item.get("height"))) is not None
    ]
    return {
        "url": validated_url,
        "title": optional_text(payload.get("title")),
        "provider": optional_text(payload.get("extractor_key") or payload.get("extractor")),
        "format_count": len(available_formats),
        "max_height": max(heights, default=None),
        "authenticated_browser_session": cookies_from_browser is not None,
        "downloaded": False,
        "rights_status": "not_evaluated",
    }


def browser_cookie_args(browser: str | None) -> list[str]:
    if browser is None:
        return []
    normalized = browser.strip().lower()
    if normalized not in SUPPORTED_COOKIE_BROWSERS:
        supported = ", ".join(sorted(SUPPORTED_COOKIE_BROWSERS))
        raise ValueError(f"Unsupported cookie browser. Choose one of: {supported}")
    return ["--cookies-from-browser", normalized]


def validate_media_url(url: str) -> str:
    value = url.strip()
    parsed = urllib.parse.urlparse(value)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or hostname not in SUPPORTED_MEDIA_HOSTS:
        raise ValueError("Media URL must be an HTTPS Bilibili or YouTube URL")
    return value


def safe_process_error(stderr: str) -> str:
    detail = stderr.strip().splitlines()[-1] if stderr.strip() else "unknown error"
    detail = re.sub(
        r"(?i)(cookie|authorization|token)(\s*[:=]\s*)\S+",
        r"\1\2<redacted>",
        detail,
    )
    return detail[:500]


def relevance_score(title: str, description: str) -> float:
    text = f"{title}\n{description}".replace(" ", "").lower()
    map_score = 0.7 if any(alias in text for alias in ("丛林魅影", "叢林魅影")) else 0.0
    game_score = (
        0.3
        if any(alias in text for alias in ("逆战未来", "逆战：未来", "逆戰未來", "逆戰：未來"))
        else 0.0
    )
    return round(min(1.0, map_score + game_score), 4)


def canonical_entry_url(provider: str, entry: dict[str, Any]) -> str:
    value = str(entry.get("webpage_url") or entry.get("url") or "")
    if value.startswith(("https://", "http://")):
        return value.replace("http://www.bilibili.com", "https://www.bilibili.com")
    identifier = str(entry.get("id") or value)
    if provider == "bilibili":
        return f"https://www.bilibili.com/video/{identifier}"
    return f"https://www.youtube.com/watch?v={identifier}"


def hydrate_bilibili_entry(entry: dict[str, Any]) -> dict[str, Any]:
    identifier = str(entry.get("id") or "")
    query = "bvid" if identifier.upper().startswith("BV") else "aid"
    url = "https://api.bilibili.com/x/web-interface/view?" + urllib.parse.urlencode(
        {query: identifier}
    )
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; LeviathanDatasetCatalog/0.1)",
            "Referer": "https://www.bilibili.com/",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        data = payload.get("data") if payload.get("code") == 0 else None
        if not isinstance(data, dict):
            return entry
        owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
        dimension = (
            data.get("dimension") if isinstance(data.get("dimension"), dict) else {}
        )
        pubdate = optional_int(data.get("pubdate"))
        return {
            **entry,
            "id": optional_text(data.get("bvid")) or identifier,
            "url": f"https://www.bilibili.com/video/{data.get('bvid') or identifier}",
            "title": data.get("title"),
            "description": data.get("desc"),
            "uploader": owner.get("name"),
            "upload_date": (
                datetime.fromtimestamp(pubdate, timezone.utc).strftime("%Y%m%d")
                if pubdate
                else None
            ),
            "duration": data.get("duration"),
            "width": dimension.get("width"),
            "height": dimension.get("height"),
            "view_count": (
                data.get("stat", {}).get("view")
                if isinstance(data.get("stat"), dict)
                else None
            ),
            "bilibili_copyright_code": data.get("copyright"),
            "bilibili_no_reprint": (
                data.get("rights", {}).get("no_reprint")
                if isinstance(data.get("rights"), dict)
                else None
            ),
        }
    except (OSError, TimeoutError, ValueError, json.JSONDecodeError):
        return entry


def hydrate_youtube_entry(
    executable: str,
    entry: dict[str, Any],
    cookies_from_browser: str | None = None,
) -> dict[str, Any]:
    url = canonical_entry_url("youtube", entry)
    process = subprocess.run(
        [
            executable,
            "--ignore-config",
            "--dump-single-json",
            "--skip-download",
            "--no-warnings",
            "--no-update",
            "--no-playlist",
            *browser_cookie_args(cookies_from_browser),
            url,
        ],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    try:
        payload = json.loads(process.stdout)
    except json.JSONDecodeError:
        return entry
    if not isinstance(payload, dict):
        return entry
    return {**entry, **payload, "url": url}


def infer_platform_rights(license_name: str | None) -> tuple[str, str | None]:
    if license_name and "creative commons" in license_name.lower():
        return (
            "permissive",
            f"Platform metadata reported this license: {license_name}",
        )
    return "unknown", None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def optional_text(value: Any) -> str | None:
    return str(value) if value not in (None, "") else None


def optional_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def optional_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
