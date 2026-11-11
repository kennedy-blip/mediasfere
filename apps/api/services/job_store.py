"""Redis-backed job state with Pub/Sub fan-out for WebSocket subscribers."""

import json
import time
import uuid
from enum import Enum
from typing import Any

import redis

from core.config import get_settings


class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    EXTRACTING = "EXTRACTING"
    TRIMMING = "TRIMMING"
    TRANSCRIBING = "TRANSCRIBING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


STAGE_PROGRESS = {
    JobStatus.QUEUED: 0,
    JobStatus.EXTRACTING: 20,
    JobStatus.TRIMMING: 60,
    JobStatus.TRANSCRIBING: 85,
    JobStatus.COMPLETED: 100,
}

TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


def job_key(job_id: str) -> str:
    return f"mediasphere:job:{job_id}"


def cancel_key(job_id: str) -> str:
    return f"mediasphere:job:{job_id}:cancel"


def channel_name(job_id: str) -> str:
    return f"mediasphere:events:{job_id}"


def is_terminal(status: str) -> bool:
    return status in {s.value for s in TERMINAL_STATUSES}


class JobStore:
    def __init__(self, client: redis.Redis, ttl_seconds: int | None = None):
        self.redis = client
        self.ttl = ttl_seconds or get_settings().job_ttl_seconds

    def create(self, **fields: Any) -> dict[str, Any]:
        now = time.time()
        job = {
            "id": uuid.uuid4().hex,
            "status": JobStatus.QUEUED.value,
            "progress": 0,
            "speed": None,
            "eta": None,
            "error": None,
            "title": None,
            "thumbnail": None,
            "duration": None,
            "file_name": None,
            "file_size": None,
            "media_type": None,
            "transcript_available": False,
            "summary": None,
            "task_id": None,
            "created_at": now,
            "updated_at": now,
            **fields,
        }
        self._save(job)
        return job

    def get(self, job_id: str) -> dict[str, Any] | None:
        raw = self.redis.get(job_key(job_id))
        return json.loads(raw) if raw else None

    def update(self, job_id: str, **fields: Any) -> dict[str, Any]:
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if "status" in fields and isinstance(fields["status"], JobStatus):
            fields["status"] = fields["status"].value
        job.update(fields, updated_at=time.time())
        self._save(job)
        return job

    def request_cancel(self, job_id: str) -> None:
        self.redis.set(cancel_key(job_id), "1", ex=self.ttl)

    def is_cancelled(self, job_id: str) -> bool:
        return bool(self.redis.exists(cancel_key(job_id)))

    def _save(self, job: dict[str, Any]) -> None:
        payload = json.dumps(job)
        self.redis.set(job_key(job["id"]), payload, ex=self.ttl)
        self.redis.publish(channel_name(job["id"]), payload)


_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _client


def get_job_store() -> JobStore:
    return JobStore(get_redis())
