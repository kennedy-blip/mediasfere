from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="MEDIASPHERE_", extra="ignore")

    app_name: str = "MediaSphere API"
    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")
    cors_origins: list[str] = ["http://localhost:3000"]
    cors_origin_regex: str | None = r"https://.*\.vercel\.app"

    media_dir: Path = Path("/tmp/mediasphere")
    job_ttl_seconds: int = 60 * 60 * 6
    max_duration_seconds: int = 60 * 60 * 2

    whisper_model: str = "small"
    whisper_device: str = "auto"
    whisper_compute_type: str = "int8"

    allowed_domains: list[str] = [
        "youtube.com",
        "youtu.be",
        "tiktok.com",
        "instagram.com",
        "x.com",
        "twitter.com",
        "reddit.com",
        "redd.it",
        "pinterest.com",
        "pin.it",
        "vimeo.com",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
