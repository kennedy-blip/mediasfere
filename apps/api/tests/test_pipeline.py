import json
from pathlib import Path

from core.config import get_settings
from services.ai_stt import Segment
from services.extractor import JobCancelled
from services.pipeline import run_job, safe_filename


def make_job(store, **overrides):
    fields = dict(
        url="https://www.youtube.com/watch?v=x", platform="youtube", quality="720p",
        start=None, end=None, precise_trim=False, subtitles=False,
    )
    fields.update(overrides)
    return store.create(**fields)


def fake_downloader(url, quality, out_dir, on_progress=None, is_cancelled=None, max_duration=None):
    out_dir.mkdir(parents=True, exist_ok=True)
    on_progress({"fraction": 0.5, "speed": 1024, "eta": 3})
    src = out_dir / "source.mp4"
    src.write_bytes(b"video-bytes")
    return src, {"title": "My Cool: Video!", "duration": 42, "thumbnail": "https://img"}


def fake_trimmer(src, dst, start, end, precise, media_type):
    dst.write_bytes(src.read_bytes())
    return dst


def test_safe_filename():
    assert safe_filename("My Cool: Video!", "id") == "My_Cool_Video"
    assert safe_filename("???", "fallback") == "fallback"


def test_pipeline_completes_with_transcript(store, media_dir):
    job = make_job(store, subtitles=True, start=1, end=5)
    seen = []
    pubsub = store.redis.pubsub()
    pubsub.subscribe(f"mediasphere:events:{job['id']}")

    def fake_audio(src, dst):
        dst.write_bytes(b"wav")
        return dst

    result = run_job(
        job["id"], store, get_settings(),
        downloader=fake_downloader, trimmer=fake_trimmer, audio_extractor=fake_audio,
        transcriber=lambda p: ([Segment(0, 2, "Hello there and welcome to the show.")], "en"),
    )
    for _ in range(100):
        msg = pubsub.get_message()
        if msg is None:
            break
        if msg["type"] == "message":
            seen.append(json.loads(msg["data"])["status"])

    assert result["status"] == "COMPLETED" and result["progress"] == 100
    assert result["file_name"] == "My_Cool_Video.mp4"
    assert result["transcript_available"] and result["summary"]["language"] == "en"
    workdir = Path(media_dir) / job["id"]
    assert (workdir / "output.mp4").read_bytes() == b"video-bytes"
    assert (workdir / "transcript.srt").read_text().startswith("1\n00:00:00,000 --> 00:00:02,000")
    assert not (workdir / "src").exists() and not (workdir / "audio.wav").exists()
    ordered = [s for i, s in enumerate(seen) if i == 0 or seen[i - 1] != s]
    assert ordered == ["EXTRACTING", "TRIMMING", "TRANSCRIBING", "COMPLETED"]


def test_pipeline_skips_transcription_when_disabled(store, media_dir):
    job = make_job(store)
    result = run_job(job["id"], store, get_settings(), downloader=fake_downloader, trimmer=fake_trimmer)
    assert result["status"] == "COMPLETED"
    assert result["transcript_available"] is False and result["summary"] is None


def test_pipeline_marks_failed(store, media_dir):
    job = make_job(store)

    def boom(*a, **k):
        raise RuntimeError("Video unavailable")

    result = run_job(job["id"], store, get_settings(), downloader=boom)
    assert result["status"] == "FAILED" and "Video unavailable" in result["error"]
    assert not (Path(media_dir) / job["id"]).exists()


def test_pipeline_honours_cancellation(store, media_dir):
    job = make_job(store)

    def cancelling(*a, **k):
        store.request_cancel(job["id"])
        raise JobCancelled()

    result = run_job(job["id"], store, get_settings(), downloader=cancelling)
    assert result["status"] == "CANCELLED"
