# MediaSphere

Secure, multi-platform media intelligence and extraction. Paste a public link from YouTube, TikTok, Instagram, X/Twitter, Reddit, Pinterest or Vimeo, pick a quality, optionally trim a time range and generate AI subtitles — progress streams live over WebSockets and every job is logged locally in your browser.

```
apps/
├── web/   Next.js 15 (App Router) + Tailwind CSS 4 + Lucide + Dexie.js  → Vercel
└── api/   FastAPI + Celery + Redis + yt-dlp + FFmpeg + Faster-Whisper  → Docker (Railway/Fly/Render…)
```

## Architecture

| Layer | What it does |
| --- | --- |
| `apps/web/lib/sanitizer.ts` | Strips tracking params (`utm_*`, `igsh`, `si`, `fbclid`, `ref_src`, `t`, …) and validates the hostname against the platform whitelist regex before anything is sent. |
| `apps/api/core/security.py` | SSRF sandbox: scheme/port/credential checks, domain allowlist, then resolves DNS and rejects private, loopback, link-local, CGNAT and cloud-metadata ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, IPv6 equivalents) with **HTTP 400**. |
| `apps/api/services/extractor.py` | yt-dlp format presets (`1080p`, `720p`, `audio_mp3_320k`) and FFmpeg trimming with `-ss`/`-to`: fast `-c copy` by default, automatic fallback to a transcode, or forced frame-accurate re-encode. |
| `apps/api/services/ai_stt.py` | Faster-Whisper (`small` by default) → timestamped `.srt`, plain text, and an extractive summary (key points, keywords, chapters). |
| `apps/api/services/pipeline.py` + `worker.py` | Celery task: `QUEUED → EXTRACTING (20%) → TRIMMING (60%) → TRANSCRIBING (85%) → COMPLETED (100%)`, with speed/ETA and cooperative cancellation. |
| `apps/api/routers/ws.py` | `/ws/jobs/{job_id}` bridges Redis Pub/Sub to the browser. |

### REST API

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/probe` | Inspect a link (title, duration, thumbnail, available qualities) |
| `POST` | `/api/jobs` | Create a job `{url, quality, start, end, precise_trim, subtitles}` |
| `GET` | `/api/jobs/{id}` | Job snapshot |
| `POST` | `/api/jobs/{id}/cancel` | Cancel a queued/running job |
| `GET` | `/api/jobs/{id}/file[?inline=1]` | Stream the result (supports HTTP Range) |
| `GET` | `/api/jobs/{id}/transcript?format=srt\|txt\|json` | Transcript |
| `WS` | `/ws/jobs/{id}` | Live status events |

## Local development

```bash
# Backend (Redis + API + worker)
docker compose up --build            # API on http://localhost:8000

# Frontend
cd apps/web
cp .env.example .env.local           # points at http://localhost:8000
pnpm install
pnpm dev                             # http://localhost:3000
```

Without Docker: run `redis-server`, then in `apps/api` `pip install -r requirements-dev.txt`, `uvicorn main:app --reload` and `celery -A worker.celery_app worker -l info`.

### Tests

```bash
cd apps/api && pytest tests/ -v
cd apps/web && pnpm lint && pnpm test && pnpm build
```

## Deploying

### Frontend → Vercel

1. Import the repo in Vercel and set **Root Directory** to `apps/web` (framework is auto-detected as Next.js; `vercel.json` pins pnpm install/build).
2. Add environment variables:
   - `NEXT_PUBLIC_API_URL` = `https://<your-api-host>`
   - `NEXT_PUBLIC_WS_URL` = `wss://<your-api-host>`
3. Deploy. If the variables are left unset the UI runs in **demo mode** (jobs are simulated client-side) so the deployment is never broken.

### Backend → any Docker host (e.g. Railway)

The API needs long-running processes, FFmpeg and local disk, so it does not run on Vercel. Deploy `apps/api/Dockerfile` as two services sharing a Redis instance and a volume mounted at `/data`:

- **api**: default command (`uvicorn`, honours `$PORT`)
- **worker**: `celery -A worker.celery_app worker --loglevel=info --concurrency=2`

| Env var | Default | |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379/0` | Broker, job state and Pub/Sub |
| `MEDIASPHERE_CORS_ORIGINS` | `["http://localhost:3000"]` | JSON list of allowed origins (add your Vercel domain) |
| `MEDIASPHERE_CORS_ORIGIN_REGEX` | `https://.*\.vercel\.app` | Regex for preview deployments |
| `MEDIASPHERE_MEDIA_DIR` | `/data/media` (Docker) | Output storage |
| `MEDIASPHERE_WHISPER_MODEL` | `small` | Any Faster-Whisper model name |
| `MEDIASPHERE_MAX_DURATION_SECONDS` | `7200` | Reject longer media |

## Responsible use

MediaSphere only processes publicly accessible media. Respect copyright, creators' rights and each platform's terms of service.
