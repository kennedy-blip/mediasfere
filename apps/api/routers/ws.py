import asyncio
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from core.config import get_settings
from services.job_store import channel_name, is_terminal, job_key

router = APIRouter(tags=["ws"])

_async_client: aioredis.Redis | None = None


def get_async_redis() -> aioredis.Redis:
    global _async_client
    if _async_client is None:
        _async_client = aioredis.Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _async_client


def _public(payload: str) -> dict:
    data = json.loads(payload)
    data.pop("task_id", None)
    return data


@router.websocket("/ws/jobs/{job_id}")
async def job_events(websocket: WebSocket, job_id: str, client: aioredis.Redis = Depends(get_async_redis)):
    await websocket.accept()
    pubsub = client.pubsub()
    await pubsub.subscribe(channel_name(job_id))
    try:
        snapshot = await client.get(job_key(job_id))
        if snapshot is None:
            await websocket.send_json({"id": job_id, "error": "Job not found", "status": "NOT_FOUND"})
            await websocket.close(code=4404)
            return
        job = _public(snapshot)
        await websocket.send_json(job)
        if is_terminal(job["status"]):
            await websocket.close()
            return

        async def watch_disconnect() -> None:
            while True:
                await websocket.receive_text()

        disconnect = asyncio.create_task(watch_disconnect())
        try:
            while not disconnect.done():
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message is None or message.get("type") != "message":
                    continue
                job = _public(message["data"])
                await websocket.send_json(job)
                if is_terminal(job["status"]):
                    await websocket.close()
                    return
        finally:
            disconnect.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel_name(job_id))
        await pubsub.aclose()
