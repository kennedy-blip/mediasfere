FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MEDIASPHERE_MEDIA_DIR=/data/media \
    HF_HOME=/data/models

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN useradd --create-home --uid 10001 app && mkdir -p /data/media /data/models && chown -R app /data
USER app

EXPOSE 8000
# Override with `celery -A worker.celery_app worker --loglevel=info --concurrency=2` for the worker service.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
