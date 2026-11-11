import sys
from pathlib import Path

import fakeredis
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import get_settings  # noqa: E402
from main import app  # noqa: E402
from routers import jobs as jobs_router  # noqa: E402
from routers import ws as ws_router  # noqa: E402
from services.job_store import JobStore, get_job_store  # noqa: E402


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "media_dir", tmp_path)
    return tmp_path


@pytest.fixture
def fake_server():
    return fakeredis.FakeServer()


@pytest.fixture
def store(fake_server):
    return JobStore(fakeredis.FakeRedis(server=fake_server, decode_responses=True))


@pytest.fixture
def public_dns(monkeypatch):
    monkeypatch.setattr("core.security.default_resolver", lambda host: ["142.250.80.46"])
    import core.security as sec

    original = sec.ensure_safe_url

    def ensure(url, resolver=None):
        return original(url, resolver or (lambda host: ["142.250.80.46"]))

    monkeypatch.setattr(jobs_router, "ensure_safe_url", ensure)


@pytest.fixture
def dispatched():
    return []


@pytest.fixture
def client(store, fake_server, dispatched, media_dir):
    app.dependency_overrides[get_job_store] = lambda: store
    app.dependency_overrides[jobs_router.get_dispatcher] = lambda: (
        lambda job_id: dispatched.append(job_id) or f"task-{job_id}"
    )
    app.dependency_overrides[jobs_router.get_revoker] = lambda: (lambda task_id: None)
    app.dependency_overrides[ws_router.get_async_redis] = lambda: fakeredis.FakeAsyncRedis(
        server=fake_server, decode_responses=True
    )
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
