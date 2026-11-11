"""yt-dlp extraction and FFmpeg trimming pipeline."""

import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

QUALITY_PRESETS: dict[str, dict[str, Any]] = {
    "1080p": {
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "media_type": "video",
        "ext": "mp4",
    },
    "720p": {
        "format": "bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/b",
        "merge_output_format": "mp4",
        "media_type": "video",
        "ext": "mp4",
    },
    "audio_mp3_320k": {
        "format": "ba/b",
        "media_type": "audio",
        "ext": "mp3",
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"}
        ],
    },
}

ProgressCallback = Callable[[dict[str, Any]], None]
CancelCheck = Callable[[], bool]

_TS_RE = re.compile(r"^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$")


class ExtractionError(RuntimeError):
    pass


class JobCancelled(RuntimeError):
    pass


@dataclass
class MediaInfo:
    title: str | None
    duration: float | None
    thumbnail: str | None
    uploader: str | None
    extractor: str | None
    qualities: list[str]


def parse_timestamp(value: str | float | int | None) -> float | None:
    """Parse 'SS', 'MM:SS', 'HH:MM:SS' (with optional fractional seconds)."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        if value < 0:
            raise ValueError("Timestamp cannot be negative")
        return float(value)
    match = _TS_RE.match(value.strip())
    if not match:
        raise ValueError(f"Invalid timestamp: {value!r}")
    parts = [p for p in match.groups() if p is not None]
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + float(part)
    return seconds


def format_timestamp(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _ydl(opts: dict[str, Any]):
    import yt_dlp

    return yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True, **opts})


def probe(url: str) -> MediaInfo:
    with _ydl({"skip_download": True}) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as exc:  # yt-dlp raises many error types
            raise ExtractionError(str(exc)) from exc
    heights = {f.get("height") for f in info.get("formats") or [] if f.get("height")}
    qualities = [q for q, h in (("1080p", 1080), ("720p", 720)) if any(x >= h for x in heights)]
    if heights and not qualities:
        qualities.append("720p")
    qualities.append("audio_mp3_320k")
    return MediaInfo(
        title=info.get("title"),
        duration=info.get("duration"),
        thumbnail=info.get("thumbnail"),
        uploader=info.get("uploader"),
        extractor=info.get("extractor_key"),
        qualities=qualities,
    )


def build_ydl_options(quality: str, out_dir: Path, max_duration: int | None = None) -> dict[str, Any]:
    if quality not in QUALITY_PRESETS:
        raise ValueError(f"Unsupported quality: {quality}")
    preset = QUALITY_PRESETS[quality]
    opts: dict[str, Any] = {
        "format": preset["format"],
        "outtmpl": str(out_dir / "source.%(ext)s"),
        "restrictfilenames": True,
        "retries": 3,
    }
    if "merge_output_format" in preset:
        opts["merge_output_format"] = preset["merge_output_format"]
    if "postprocessors" in preset:
        opts["postprocessors"] = preset["postprocessors"]
    if max_duration:
        from yt_dlp.utils import match_filter_func

        opts["match_filter"] = match_filter_func(f"duration <=? {max_duration}")
    return opts


def download(
    url: str,
    quality: str,
    out_dir: Path,
    on_progress: ProgressCallback | None = None,
    is_cancelled: CancelCheck | None = None,
    max_duration: int | None = None,
) -> tuple[Path, dict[str, Any]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    opts = build_ydl_options(quality, out_dir, max_duration)

    def hook(d: dict[str, Any]) -> None:
        if is_cancelled and is_cancelled():
            raise JobCancelled("Job cancelled")
        if on_progress and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes") or 0
            on_progress(
                {
                    "fraction": (done / total) if total else None,
                    "speed": d.get("speed"),
                    "eta": d.get("eta"),
                }
            )

    opts["progress_hooks"] = [hook]
    with _ydl(opts) as ydl:
        try:
            info = ydl.extract_info(url, download=True)
        except JobCancelled:
            raise
        except Exception as exc:
            if isinstance(exc.__cause__, JobCancelled) or "cancelled" in str(exc).lower():
                raise JobCancelled("Job cancelled") from exc
            raise ExtractionError(str(exc)) from exc

    ext = QUALITY_PRESETS[quality]["ext"]
    candidates = sorted(out_dir.glob(f"source.{ext}")) or sorted(out_dir.glob("source.*"))
    if not candidates:
        raise ExtractionError("Download finished but no output file was produced")
    return candidates[0], info


def build_trim_command(
    src: Path, dst: Path, start: float | None, end: float | None, precise: bool, media_type: str
) -> list[str]:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    if precise:
        cmd += ["-i", str(src)]
        if start is not None:
            cmd += ["-ss", format_timestamp(start)]
        if end is not None:
            cmd += ["-to", format_timestamp(end)]
        if media_type == "audio":
            cmd += ["-c:a", "libmp3lame", "-b:a", "320k"]
        else:
            cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k"]
            cmd += ["-movflags", "+faststart"]
    else:
        if start is not None:
            cmd += ["-ss", format_timestamp(start)]
        if end is not None:
            cmd += ["-to", format_timestamp(end)]
        cmd += ["-i", str(src), "-c", "copy", "-avoid_negative_ts", "make_zero"]
        if media_type == "video":
            cmd += ["-movflags", "+faststart"]
    cmd.append(str(dst))
    return cmd


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def trim(
    src: Path,
    dst: Path,
    start: float | None,
    end: float | None,
    precise: bool,
    media_type: str,
    runner: Callable[[list[str]], subprocess.CompletedProcess] = _run,
) -> Path:
    """Trim with fast stream copy; fall back to a transcode on failure or when precise."""
    if start is None and end is None:
        shutil.copyfile(src, dst)
        return dst
    result = runner(build_trim_command(src, dst, start, end, precise, media_type))
    if result.returncode != 0 and not precise:
        result = runner(build_trim_command(src, dst, start, end, True, media_type))
    if result.returncode != 0:
        raise ExtractionError(f"ffmpeg trim failed: {result.stderr.strip()[-500:]}")
    return dst


def extract_audio_for_stt(
    src: Path, dst: Path, runner: Callable[[list[str]], subprocess.CompletedProcess] = _run
) -> Path:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst),
    ]
    result = runner(cmd)
    if result.returncode != 0:
        raise ExtractionError(f"ffmpeg audio extraction failed: {result.stderr.strip()[-500:]}")
    return dst
