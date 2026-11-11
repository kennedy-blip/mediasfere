from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routers import jobs, ws

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition", "Content-Length", "Accept-Ranges", "Content-Range"],
)
app.include_router(jobs.router)
app.include_router(ws.router)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
