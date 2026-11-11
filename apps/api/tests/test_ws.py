import threading
import time


def test_ws_sends_snapshot_and_closes_on_terminal(client, store):
    job = store.create(url="https://vimeo.com/1", quality="720p")
    store.update(job["id"], status="COMPLETED", progress=100)
    with client.websocket_connect(f"/ws/jobs/{job['id']}") as ws:
        data = ws.receive_json()
        assert data["status"] == "COMPLETED" and "task_id" not in data


def test_ws_unknown_job(client):
    with client.websocket_connect("/ws/jobs/missing") as ws:
        assert ws.receive_json()["status"] == "NOT_FOUND"


def test_ws_streams_stage_updates(client, store):
    job = store.create(url="https://vimeo.com/1", quality="720p")

    def worker():
        time.sleep(0.3)
        for status, progress in [("EXTRACTING", 20), ("TRIMMING", 60), ("TRANSCRIBING", 85), ("COMPLETED", 100)]:
            store.update(job["id"], status=status, progress=progress)
            time.sleep(0.05)

    with client.websocket_connect(f"/ws/jobs/{job['id']}") as ws:
        assert ws.receive_json()["status"] == "QUEUED"
        threading.Thread(target=worker, daemon=True).start()
        statuses = []
        while True:
            data = ws.receive_json()
            statuses.append((data["status"], data["progress"]))
            if data["status"] == "COMPLETED":
                break
    assert statuses == [("EXTRACTING", 20), ("TRIMMING", 60), ("TRANSCRIBING", 85), ("COMPLETED", 100)]
