from __future__ import annotations

import json
import hashlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class VideoProbe:
    duration_seconds: float
    width: int
    height: int
    fps: float
    frame_count: int


def require_media_tools() -> None:
    missing = [name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None]
    if missing:
        raise RuntimeError(f"Missing media tools on PATH: {', '.join(missing)}")


def probe_video(path: Path) -> VideoProbe:
    require_media_tools()
    process = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,avg_frame_rate,nb_frames:format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    payload = json.loads(process.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise ValueError(f"No video stream found in {path}")
    stream = streams[0]
    duration = float((payload.get("format") or {}).get("duration") or 0)
    numerator, _, denominator = str(stream.get("avg_frame_rate") or "0/1").partition("/")
    fps = float(numerator) / max(1.0, float(denominator or 1))
    frame_count_value = stream.get("nb_frames")
    frame_count = int(frame_count_value) if str(frame_count_value).isdigit() else round(duration * fps)
    probe = VideoProbe(
        duration_seconds=duration,
        width=int(stream.get("width") or 0),
        height=int(stream.get("height") or 0),
        fps=fps,
        frame_count=frame_count,
    )
    if probe.duration_seconds <= 0 or probe.width <= 0 or probe.height <= 0:
        raise ValueError(f"Unreadable video metadata for {path}")
    return probe


def extract_clip(
    source: Path,
    destination: Path,
    start_seconds: float,
    duration_seconds: float,
) -> None:
    require_media_tools()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".partial.mp4")
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration_seconds:.3f}",
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(temporary),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def video_fingerprint(path: Path, interval_seconds: float = 10.0) -> str:
    """Build a compact visual fingerprint from low-resolution sampled frames."""
    require_media_tools()
    process = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-vf",
            f"fps=1/{interval_seconds:g},scale=9:8,format=gray",
            "-frames:v",
            "64",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    frame_size = 9 * 8
    hashes = bytearray()
    for offset in range(0, len(process.stdout) - frame_size + 1, frame_size):
        frame = process.stdout[offset : offset + frame_size]
        value = 0
        for row in range(8):
            base = row * 9
            for column in range(8):
                value = (value << 1) | int(frame[base + column] > frame[base + column + 1])
        hashes.extend(value.to_bytes(8, "big"))
    if not hashes:
        raise ValueError(f"Could not sample frames from {path}")
    return hashlib.sha256(hashes).hexdigest()
