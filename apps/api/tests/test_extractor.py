import subprocess
from pathlib import Path

import pytest

from services import extractor
from services.extractor import (
    ExtractionError,
    build_trim_command,
    build_ydl_options,
    format_timestamp,
    parse_timestamp,
)


@pytest.mark.parametrize(
    "value,expected",
    [("90", 90.0), ("01:30", 90.0), ("1:02:03", 3723.0), ("00:00:01.5", 1.5), (12, 12.0), ("", None), (None, None)],
)
def test_parse_timestamp(value, expected):
    assert parse_timestamp(value) == expected


@pytest.mark.parametrize("value", ["abc", "1:2:3:4", "-5", -1])
def test_parse_timestamp_invalid(value):
    with pytest.raises(ValueError):
        parse_timestamp(value)


def test_format_timestamp():
    assert format_timestamp(3723.25) == "01:02:03.250"


def test_fast_trim_uses_stream_copy_with_input_seeking():
    cmd = build_trim_command(Path("in.mp4"), Path("out.mp4"), 10, 20, False, "video")
    assert cmd.index("-ss") < cmd.index("-i")
    assert ["-c", "copy"] == cmd[cmd.index("-c") : cmd.index("-c") + 2]
    assert "00:00:10.000" in cmd and "00:00:20.000" in cmd
    assert cmd[-1] == "out.mp4"


def test_precise_trim_transcodes_video():
    cmd = build_trim_command(Path("in.mp4"), Path("out.mp4"), 10, 20, True, "video")
    assert cmd.index("-i") < cmd.index("-ss")
    assert "libx264" in cmd and "copy" not in cmd


def test_precise_trim_audio_uses_mp3_320k():
    cmd = build_trim_command(Path("in.mp3"), Path("out.mp3"), None, 30, True, "audio")
    assert "-ss" not in cmd and "-to" in cmd
    assert "libmp3lame" in cmd and "320k" in cmd


def _proc(code, stderr=""):
    return subprocess.CompletedProcess(args=[], returncode=code, stdout="", stderr=stderr)


def test_trim_falls_back_to_transcode_when_copy_fails(tmp_path):
    calls = []

    def runner(cmd):
        calls.append(cmd)
        return _proc(1 if "copy" in cmd else 0)

    extractor.trim(tmp_path / "in.mp4", tmp_path / "out.mp4", 5, 10, False, "video", runner=runner)
    assert len(calls) == 2
    assert "copy" in calls[0] and "libx264" in calls[1]


def test_trim_raises_when_transcode_fails(tmp_path):
    with pytest.raises(ExtractionError):
        extractor.trim(tmp_path / "a", tmp_path / "b", 0, 1, True, "video", runner=lambda c: _proc(1, "boom"))


def test_trim_without_range_copies_file(tmp_path):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"data")
    out = extractor.trim(src, tmp_path / "out.mp4", None, None, False, "video", runner=lambda c: _proc(1))
    assert out.read_bytes() == b"data"


def test_ydl_options_for_presets(tmp_path):
    video = build_ydl_options("1080p", tmp_path)
    assert "height<=1080" in video["format"] and video["merge_output_format"] == "mp4"
    audio = build_ydl_options("audio_mp3_320k", tmp_path)
    assert audio["postprocessors"][0]["preferredquality"] == "320"
    with pytest.raises(ValueError):
        build_ydl_options("4k", tmp_path)


@pytest.mark.skipif(subprocess.run(["which", "ffmpeg"], capture_output=True).returncode != 0, reason="ffmpeg missing")
def test_real_ffmpeg_trim(tmp_path):
    src = tmp_path / "tone.mp3"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", str(src)],
        check=True,
    )
    out = extractor.trim(src, tmp_path / "out.mp3", 1, 3, True, "audio")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True,
    )
    assert 1.8 < float(probe.stdout) < 2.3
