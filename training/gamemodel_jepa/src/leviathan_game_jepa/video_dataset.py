from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

from .io_utils import read_jsonl
from .records import ClipRecord, SourceWindowRecord


class FFmpegClipDataset:
    def __init__(
        self,
        dataset_dir: Path,
        split: str,
        frames: int,
        width: int,
        height: int,
        cache: bool = True,
    ) -> None:
        try:
            import torch
        except ImportError as error:
            raise RuntimeError("Install the training extra to use the video dataset") from error
        self._torch = torch
        self.dataset_dir = dataset_dir.resolve()
        self.frames = frames
        self.width = width
        self.height = height
        self.cache = cache
        clips_path = self.dataset_dir / "clips.jsonl"
        windows_path = self.dataset_dir / "windows.jsonl"
        if clips_path.exists():
            self.items: list[ClipRecord | SourceWindowRecord] = [
                ClipRecord.from_dict(value)
                for value in read_jsonl(clips_path)
                if value.get("split") == split
            ]
        elif windows_path.exists():
            self.items = [
                SourceWindowRecord.from_dict(value)
                for value in read_jsonl(windows_path)
                if value.get("split") == split
            ]
        else:
            raise FileNotFoundError(
                f"Neither clips.jsonl nor windows.jsonl exists in {self.dataset_dir}"
            )
        if frames <= 0 or width <= 0 or height <= 0:
            raise ValueError("Frame count and dimensions must be positive")
        self.cache_dir = self.dataset_dir / ".cache" / (
            f"rgb-v1-{frames}x{width}x{height}"
        )

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int) -> dict[str, Any]:
        import numpy as np

        item = self.items[index]
        item_id = item.clip_id if isinstance(item, ClipRecord) else item.window_id
        cache_path = self.cache_dir / f"{item_id}.npy"
        if self.cache and cache_path.exists():
            frames = np.load(cache_path, allow_pickle=False)
        else:
            frames = self._decode(item)
            if self.cache:
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                temporary = cache_path.with_suffix(".tmp.npy")
                np.save(temporary, frames, allow_pickle=False)
                temporary.replace(cache_path)
        tensor = self._torch.from_numpy(frames).float().div_(127.5).sub_(1.0)
        tensor = tensor.permute(3, 0, 1, 2).contiguous()
        return {"video": tensor, "clip_id": item_id}

    def _decode(self, item: ClipRecord | SourceWindowRecord):
        import numpy as np

        if isinstance(item, ClipRecord):
            path = (self.dataset_dir / item.local_path).resolve()
            path.relative_to(self.dataset_dir)
            start_seconds = 0.0
        else:
            path = Path(item.source_path).resolve()
            start_seconds = item.start_seconds
        if not path.is_file():
            raise FileNotFoundError(path)
        sampling_fps = self.frames / max(item.duration_seconds, 0.001)
        filter_graph = (
            f"fps={sampling_fps:.8f},"
            f"scale={self.width}:{self.height}:force_original_aspect_ratio=decrease,"
            f"pad={self.width}:{self.height}:(ow-iw)/2:(oh-ih)/2:black"
        )
        process = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{start_seconds:.3f}",
                "-i",
                str(path),
                "-t",
                f"{item.duration_seconds:.3f}",
                "-vf",
                filter_graph,
                "-frames:v",
                str(self.frames),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
        )
        frame_size = self.width * self.height * 3
        available = len(process.stdout) // frame_size
        if available == 0:
            raise ValueError(f"No decodable frames in {item_id_for_error(item)}")
        frames = np.frombuffer(process.stdout[: available * frame_size], dtype=np.uint8)
        frames = frames.reshape(available, self.height, self.width, 3).copy()
        if available < self.frames:
            padding = np.repeat(frames[-1:], self.frames - available, axis=0)
            frames = np.concatenate([frames, padding], axis=0)
        return frames[: self.frames]


def item_id_for_error(item: ClipRecord | SourceWindowRecord) -> str:
    return item.clip_id if isinstance(item, ClipRecord) else item.window_id


def dataset_cache_key(config: dict[str, Any]) -> str:
    payload = json.dumps(config, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]
