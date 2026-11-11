from services.ai_stt import Segment, format_srt_timestamp, segments_to_srt, segments_to_text, summarize

SEGMENTS = [
    Segment(0.0, 2.5, "Welcome to the MediaSphere platform walkthrough."),
    Segment(2.5, 6.0, "Today we explain how secure media extraction works on every platform."),
    Segment(6.0, 70.0, "The extraction pipeline downloads media and trims it with FFmpeg quickly."),
    Segment(70.0, 75.5, "Finally the transcription pipeline creates subtitles for the extracted media."),
]


def test_srt_timestamp():
    assert format_srt_timestamp(3723.456) == "01:02:03,456"
    assert format_srt_timestamp(-1) == "00:00:00,000"


def test_segments_to_srt():
    srt = segments_to_srt(SEGMENTS[:2])
    assert srt.startswith("1\n00:00:00,000 --> 00:00:02,500\nWelcome")
    assert "\n2\n00:00:02,500 --> 00:00:06,000\n" in srt


def test_segments_to_text():
    assert segments_to_text(SEGMENTS[:2]).startswith("Welcome to the MediaSphere platform walkthrough. Today")


def test_summarize_structure():
    summary = summarize(SEGMENTS, "en", max_points=2)
    assert summary["language"] == "en"
    assert summary["duration"] == 75.5
    assert summary["word_count"] > 20
    assert "media" in summary["keywords"] or "extraction" in summary["keywords"]
    assert len(summary["key_points"]) == 2
    assert summary["chapters"][0]["start"] == 0.0
    assert any(c["start"] >= 60 for c in summary["chapters"])


def test_summarize_empty():
    assert summarize([])["word_count"] == 0
