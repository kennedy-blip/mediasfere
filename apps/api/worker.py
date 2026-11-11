from celery import Celery

from core.config import get_settings
from services.job_store import get_job_store
from services.pipeline import run_job

settings = get_settings()

celery_app = Celery("mediasphere", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    result_expires=settings.job_ttl_seconds,
    broker_connection_retry_on_startup=True,
)


@celery_app.task(name="mediasphere.process_job")
def process_job(job_id: str) -> dict:
    job = run_job(job_id, get_job_store())
    return {"id": job["id"], "status": job["status"]}
