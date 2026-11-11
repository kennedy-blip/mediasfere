import pytest

from services.extractor import MediaInfo
from routers import jobs as jobs_router
from main import app


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_create_job_dispatches(client, dispatched, public_dns):
    res = client.post(
        "/api/jobs",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "quality": "audio_mp3_320k", "start": "0:10", "end": "1:00", "subtitles": True},
    )
    assert res.status_code == 201, res.text
    job = res.json()
    assert job["status"] == "QUEUED" and job["platform"] == "youtube"
    assert job["start"] == 10 and job["end"] == 60 and job["subtitles"] is True
    assert "task_id" not in job
    assert dispatched == [job["id"]]
    assert client.get(f"/api/jobs/{job['id']}").json()["id"] == job["id"]


def test_create_job_rejects_ssrf(client, dispatched):
    res = client.post("/api/jobs", json={"url": "http://169.254.169.254/latest/meta-data"})
    assert res.status_code == 400
    assert dispatched == []


def test_create_job_rejects_private_dns(client, monkeypatch):
    import core.security as sec

    original = sec.ensure_safe_url
    monkeypatch.setattr(jobs_router, "ensure_safe_url", lambda url: original(url, lambda h: ["10.0.0.5"]))
    res = client.post("/api/jobs", json={"url": "https://www.tiktok.com/@a/video/1"})
    assert res.status_code == 400 and "blocked" in res.json()["detail"]


def test_create_job_rejects_unsupported_domain(client):
    res = client.post("/api/jobs", json={"url": "https://example.com/v.mp4"})
    assert res.status_code == 400


@pytest.mark.parametrize("body", [{"start": "0:30", "end": "0:10"}, {"quality": "4k"}, {"start": "abc"}])
def test_create_job_validation(client, public_dns, body):
    res = client.post("/api/jobs", json={"url": "https://vimeo.com/1", **body})
    assert res.status_code == 422


def test_unknown_job_404(client):
    assert client.get("/api/jobs/nope").status_code == 404


def test_cancel_queued_job(client, public_dns):
    job = client.post("/api/jobs", json={"url": "https://vimeo.com/1"}).json()
    res = client.post(f"/api/jobs/{job['id']}/cancel")
    assert res.json()["status"] == "CANCELLED"


def test_cancel_running_job_sets_flag(client, store, public_dns):
    job = client.post("/api/jobs", json={"url": "https://vimeo.com/1"}).json()
    store.update(job["id"], status="EXTRACTING")
    client.post(f"/api/jobs/{job['id']}/cancel")
    assert store.is_cancelled(job["id"])


def test_download_and_transcript(client, store, media_dir):
    job = store.create(url="https://vimeo.com/1", quality="720p")
    assert client.get(f"/api/jobs/{job['id']}/file").status_code == 409
    workdir = media_dir / job["id"]
    workdir.mkdir()
    (workdir / "output.mp4").write_bytes(b"0123456789")
    (workdir / "transcript.srt").write_text("1\n00:00:00,000 --> 00:00:01,000\nHi\n")
    store.update(job["id"], status="COMPLETED", file_name="clip.mp4", transcript_available=True)

    res = client.get(f"/api/jobs/{job['id']}/file")
    assert res.status_code == 200 and res.content == b"0123456789"
    assert 'filename="clip.mp4"' in res.headers["content-disposition"]
    assert res.headers["content-disposition"].startswith("attachment")
    assert client.get(f"/api/jobs/{job['id']}/file?inline=1").headers["content-disposition"].startswith("inline")

    ranged = client.get(f"/api/jobs/{job['id']}/file", headers={"Range": "bytes=2-5"})
    assert ranged.status_code == 206 and ranged.content == b"2345"

    srt = client.get(f"/api/jobs/{job['id']}/transcript?format=srt")
    assert srt.status_code == 200 and "Hi" in srt.text
    assert client.get(f"/api/jobs/{job['id']}/transcript?format=txt").status_code == 410


def test_probe(client, public_dns):
    app.dependency_overrides[jobs_router.get_prober] = lambda: (
        lambda url: MediaInfo("Title", 12.0, None, "me", "Youtube", ["720p", "audio_mp3_320k"])
    )
    res = client.post("/api/probe", json={"url": "https://www.youtube.com/watch?v=1"})
    assert res.status_code == 200
    assert res.json()["title"] == "Title" and res.json()["platform"] == "youtube"


def test_cors_allows_vercel_preview(client):
    res = client.options(
        "/api/jobs",
        headers={"Origin": "https://mediasphere-git-main.vercel.app", "Access-Control-Request-Method": "POST"},
    )
    assert res.headers.get("access-control-allow-origin") == "https://mediasphere-git-main.vercel.app"
