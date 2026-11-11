"""Faster-Whisper transcription, SRT rendering and extractive summaries."""

import re
from collections import Counter
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from core.config import get_settings

STOPWORDS = set(
    """a about above after again against all am an and any are as at be because been before being
    below between both but by can could did do does doing down during each few for from further had
    has have having he her here hers herself him himself his how i if in into is it its itself just
    me more most my myself no nor not now of off on once only or other our ours ourselves out over
    own same she should so some such than that the their theirs them themselves then there these they
    this those through to too under until up very was we were what when where which while who whom
    why will with would you your yours yourself yourselves yeah okay oh um uh like gonna really""".split()
)


@dataclass
class Segment:
    start: float
    end: float
    text: str


@lru_cache(maxsize=1)
def _load_model(name: str, device: str, compute_type: str):
    from faster_whisper import WhisperModel

    return WhisperModel(name, device=device, compute_type=compute_type)


def transcribe(audio_path: Path, model_name: str | None = None) -> tuple[list[Segment], str | None]:
    settings = get_settings()
    model = _load_model(
        model_name or settings.whisper_model, settings.whisper_device, settings.whisper_compute_type
    )
    segments, info = model.transcribe(str(audio_path), vad_filter=True, beam_size=5)
    result = [Segment(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
    return result, getattr(info, "language", None)


def format_srt_timestamp(seconds: float) -> str:
    ms = int(round(max(seconds, 0) * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def segments_to_srt(segments: list[Segment]) -> str:
    blocks = [
        f"{i}\n{format_srt_timestamp(seg.start)} --> {format_srt_timestamp(seg.end)}\n{seg.text}\n"
        for i, seg in enumerate(segments, start=1)
    ]
    return "\n".join(blocks)


def segments_to_text(segments: list[Segment]) -> str:
    return " ".join(seg.text for seg in segments).strip()


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-zA-Z']+", text.lower()) if w not in STOPWORDS and len(w) > 2]


def summarize(segments: list[Segment], language: str | None = None, max_points: int = 5) -> dict[str, Any]:
    """Lightweight extractive summary: keywords, top sentences, and timed chapters."""
    full_text = segments_to_text(segments)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", full_text) if len(s.strip()) > 20]
    freq = Counter(_words(full_text))
    top_freq = max(freq.values(), default=1)

    def score(sentence: str) -> float:
        words = _words(sentence)
        return sum(freq[w] / top_freq for w in words) / (len(words) or 1) * min(len(words), 20)

    ranked = sorted(range(len(sentences)), key=lambda i: score(sentences[i]), reverse=True)
    key_points = [sentences[i] for i in sorted(ranked[:max_points])]

    chapters: list[dict[str, Any]] = []
    if segments:
        total = segments[-1].end
        window = max(60.0, total / 6)
        next_mark = 0.0
        for seg in segments:
            if seg.start >= next_mark:
                chapters.append({"start": round(seg.start, 2), "text": seg.text})
                next_mark = seg.start + window

    return {
        "language": language,
        "duration": round(segments[-1].end, 2) if segments else 0,
        "word_count": len(full_text.split()),
        "keywords": [w for w, _ in freq.most_common(8)],
        "key_points": key_points,
        "chapters": chapters,
    }


def segments_to_json(segments: list[Segment]) -> list[dict[str, Any]]:
    return [asdict(s) for s in segments]
