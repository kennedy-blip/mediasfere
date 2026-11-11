"""End-to-end job pipeline executed by the Celery worker."""

import json
import re
import shutil
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from core.config import Settings, get_settings
from services import ai_stt, extractor
from services.extractor import JobCancelled
from services.job_store import STAGE_PROGRESS, JobStatus, JobStore


def safe_filename(title: str | None, fallback: str) -> str:
    name = re.sub(r"[^\w\- ]+", "", title or "").strip().replace(" ", "_")
    return (name[:80] or fallback).strip("_") or fallback


def job_dir(job_id: str, settings: Settings | None = None) -> Path:
    settings = settings or get_settings()
    return Path(settings.media_dir) / job_id


def _scale(fraction: float, lo: int, hi: int) -> int:
    return int(lo + (hi - lo) * max(0.0, min(fraction, 1.0)))


def run_job(
    job_id: str,
    store: JobStore,
    settings: Settings | None = None,
    downloader: Callable[..., tuple[Path, dict[str, Any]]] = extractor.download,
    trimmer: Callable[..., Path] = extractor.trim,
    audio_extractor: Callable[..., Path] = extractor.extract_audio_for_stt,
    transcriber: Callable[..., tuple[list[ai_stt.Segment], str | None]] = ai_stt.transcribe,
) -> dict[str, Any]:
    settings = settings or get_settings()
    job = store.get(job_id)
    if job is None:
        raise KeyError(job_id)

    workdir = job_dir(job_id, settings)
    workdir.mkdir(parents=True, exist_ok=True)

    def check_cancel() -> None:
        if store.is_cancelled(job_id):
            raise JobCancelled("Job cancelled")

    try:
        check_cancel()
        store.update(job_id, status=JobStatus.EXTRACTING, progress=STAGE_PROGRESS[JobStatus.EXTRACTING])

        last_emit = 0.0

        def on_progress(p: dict[str, Any]) -> None:
            nonlocal last_emit
            now = time.monotonic()
            if now - last_emit < 0.5:
                return
            last_emit = now
            fields: dict[str, Any] = {"speed": p.get("speed"), "eta": p.get("eta")}
            if p.get("fraction") is not None:
                fields["progress"] = _scale(p["fraction"], 20, 59)
            store.update(job_id, **fields)

        source, info = downloader(
            job["url"],
            job["quality"],
            workdir / "src",
            on_progress=on_progress,
            is_cancelled=lambda: store.is_cancelled(job_id),
            max_duration=settings.max_duration_seconds,
        )
        title = info.get("title") or job.get("title")
        store.update(
            job_id,
            title=title,
            thumbnail=info.get("thumbnail"),
            duration=info.get("duration"),
            speed=None,
            eta=None,
        )

        check_cancel()
        store.update(job_id, status=JobStatus.TRIMMING, progress=STAGE_PROGRESS[JobStatus.TRIMMING])
        preset = extractor.QUALITY_PRESETS[job["quality"]]
        file_name = f"{safe_filename(title, job_id)}.{preset['ext']}"
        output = trimmer(
            source,
            workdir / f"output.{preset['ext']}",
            job.get("start"),
            job.get("end"),
            bool(job.get("precise_trim")),
            preset["media_type"],
        )
        shutil.rmtree(workdir / "src", ignore_errors=True)

        summary = None
        if job.get("subtitles"):
            check_cancel()
            store.update(
                job_id, status=JobStatus.TRANSCRIBING, progress=STAGE_PROGRESS[JobStatus.TRANSCRIBING]
            )
            wav = audio_extractor(output, workdir / "audio.wav")
            segments, language = transcriber(wav)
            wav.unlink(missing_ok=True)
            (workdir / "transcript.srt").write_text(ai_stt.segments_to_srt(segments), encoding="utf-8")
            (workdir / "transcript.txt").write_text(ai_stt.segments_to_text(segments), encoding="utf-8")
            (workdir / "transcript.json").write_text(
                json.dumps(ai_stt.segments_to_json(segments)), encoding="utf-8"
            )
            summary = ai_stt.summarize(segments, language)

        return store.update(
            job_id,
            status=JobStatus.COMPLETED,
            progress=100,
            file_name=file_name,
            file_size=output.stat().st_size,
            media_type=preset["media_type"],
            transcript_available=summary is not None,
            summary=summary,
            speed=None,
            eta=None,
        )
    except JobCancelled:
        shutil.rmtree(workdir, ignore_errors=True)
        return store.update(job_id, status=JobStatus.CANCELLED, speed=None, eta=None)
    except Exception as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        if store.is_cancelled(job_id):
            return store.update(job_id, status=JobStatus.CANCELLED, speed=None, eta=None)
        return store.update(job_id, status=JobStatus.FAILED, error=str(exc)[:500], speed=None, eta=None)
