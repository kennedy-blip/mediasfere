from collections.abc import Callable
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from core.config import get_settings
from core.security import ensure_safe_url
from services import extractor
from services.job_store import JobStatus, JobStore, get_job_store, is_terminal
from services.pipeline import job_dir

router = APIRouter(prefix="/api", tags=["jobs"])

Quality = Literal["1080p", "720p", "audio_mp3_320k"]


class ProbeRequest(BaseModel):
    url: str = Field(max_length=2048)


class JobCreate(BaseModel):
    url: str = Field(max_length=2048)
    quality: Quality = "720p"
    start: float | None = None
    end: float | None = None
    precise_trim: bool = False
    subtitles: bool = False

    @field_validator("start", "end", mode="before")
    @classmethod
    def _parse_ts(cls, value):
        try:
            return extractor.parse_timestamp(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @model_validator(mode="after")
    def _check_range(self):
        if self.start is not None and self.end is not None and self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


def detect_platform(url: str) -> str:
    from urllib.parse import urlsplit

    host = (urlsplit(url).hostname or "").lower()
    mapping = {
        "youtu": "youtube",
        "tiktok": "tiktok",
        "instagram": "instagram",
        "twitter": "x",
        "x.com": "x",
        "redd": "reddit",
        "pinterest": "pinterest",
        "pin.it": "pinterest",
        "vimeo": "vimeo",
    }
    for needle, name in mapping.items():
        if needle in host:
            return name
    return "unknown"


def get_dispatcher() -> Callable[[str], str]:
    from worker import process_job

    return lambda job_id: process_job.delay(job_id).id


def get_revoker() -> Callable[[str], None]:
    from worker import celery_app

    def revoke(task_id: str) -> None:
        try:
            celery_app.control.revoke(task_id)
        except Exception:
            pass

    return revoke


def get_prober() -> Callable[[str], extractor.MediaInfo]:
    return extractor.probe


def _get_job_or_404(store: JobStore, job_id: str) -> dict:
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def public_job(job: dict) -> dict:
    return {k: v for k, v in job.items() if k != "task_id"}


@router.post("/probe")
async def probe_url(body: ProbeRequest, prober=Depends(get_prober)):
    url = await run_in_threadpool(ensure_safe_url, body.url)
    try:
        info = await run_in_threadpool(prober, url)
    except extractor.ExtractionError as exc:
        raise HTTPException(status_code=422, detail=f"Could not read media: {exc}") from exc
    return {"url": url, "platform": detect_platform(url), **info.__dict__}


@router.post("/jobs", status_code=201)
def create_job(
    body: JobCreate,
    store: JobStore = Depends(get_job_store),
    dispatch: Callable[[str], str] = Depends(get_dispatcher),
):
    url = ensure_safe_url(body.url)
    job = store.create(
        url=url,
        platform=detect_platform(url),
        quality=body.quality,
        start=body.start,
        end=body.end,
        precise_trim=body.precise_trim,
        subtitles=body.subtitles,
    )
    task_id = dispatch(job["id"])
    job = store.update(job["id"], task_id=task_id)
    return public_job(job)


@router.get("/jobs/{job_id}")
def get_job(job_id: str, store: JobStore = Depends(get_job_store)):
    return public_job(_get_job_or_404(store, job_id))


@router.post("/jobs/{job_id}/cancel")
def cancel_job(
    job_id: str,
    store: JobStore = Depends(get_job_store),
    revoke: Callable[[str], None] = Depends(get_revoker),
):
    job = _get_job_or_404(store, job_id)
    if is_terminal(job["status"]):
        return public_job(job)
    store.request_cancel(job_id)
    if job["status"] == JobStatus.QUEUED.value:
        if job.get("task_id"):
            revoke(job["task_id"])
        job = store.update(job_id, status=JobStatus.CANCELLED)
    return public_job(job)


def _completed_file(job: dict) -> Path:
    if job["status"] != JobStatus.COMPLETED.value or not job.get("file_name"):
        raise HTTPException(status_code=409, detail="Job is not completed")
    ext = job["file_name"].rsplit(".", 1)[-1]
    path = job_dir(job["id"]) / f"output.{ext}"
    if not path.is_file():
        raise HTTPException(status_code=410, detail="File has expired")
    return path


@router.get("/jobs/{job_id}/file")
def download_file(
    job_id: str,
    inline: bool = Query(False),
    store: JobStore = Depends(get_job_store),
):
    job = _get_job_or_404(store, job_id)
    path = _completed_file(job)
    media_type = "audio/mpeg" if path.suffix == ".mp3" else "video/mp4"
    return FileResponse(
        path,
        media_type=media_type,
        filename=job["file_name"],
        content_disposition_type="inline" if inline else "attachment",
    )


@router.get("/jobs/{job_id}/transcript")
def get_transcript(
    job_id: str,
    format: Literal["srt", "txt", "json"] = Query("srt"),
    store: JobStore = Depends(get_job_store),
):
    job = _get_job_or_404(store, job_id)
    if not job.get("transcript_available"):
        raise HTTPException(status_code=404, detail="No transcript for this job")
    path = job_dir(job_id) / f"transcript.{format}"
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Transcript has expired")
    media_types = {"srt": "application/x-subrip", "txt": "text/plain", "json": "application/json"}
    stem = job["file_name"].rsplit(".", 1)[0]
    return PlainTextResponse(
        path.read_text(encoding="utf-8"),
        media_type=media_types[format],
        headers={"Content-Disposition": f'inline; filename="{stem}.{format}"'},
    )


@router.get("/config")
def public_config():
    return {"allowed_domains": get_settings().allowed_domains, "qualities": list(extractor.QUALITY_PRESETS)}
