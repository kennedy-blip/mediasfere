import pytest
from fastapi import HTTPException

from core.security import (
    UnsafeURLError,
    ensure_safe_url,
    is_allowed_host,
    is_ip_blocked,
    validate_public_url,
)

PUBLIC = lambda host: ["142.250.80.46"]  # noqa: E731


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "127.10.0.5",
        "10.1.2.3",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.10",
        "169.254.169.254",
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "100.64.0.1",
    ],
)
def test_blocked_ips(ip):
    assert is_ip_blocked(ip)


@pytest.mark.parametrize("ip", ["142.250.80.46", "151.101.1.140", "2607:f8b0:4004:c07::64"])
def test_public_ips_allowed(ip):
    assert not is_ip_blocked(ip)


@pytest.mark.parametrize(
    "host,expected",
    [
        ("youtube.com", True),
        ("www.youtube.com", True),
        ("m.youtube.com", True),
        ("youtu.be", True),
        ("vm.tiktok.com", True),
        ("x.com", True),
        ("old.reddit.com", True),
        ("evil-youtube.com", False),
        ("youtube.com.evil.io", False),
        ("example.com", False),
    ],
)
def test_allowlist(host, expected):
    assert is_allowed_host(host) is expected


def test_valid_url_passes():
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert validate_public_url(url, PUBLIC) == url


@pytest.mark.parametrize(
    "url",
    [
        "ftp://youtube.com/video",
        "file:///etc/passwd",
        "https://user:pass@youtube.com/watch?v=1",
        "https://youtube.com:8080/watch?v=1",
        "http://127.0.0.1/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "https://example.com/video.mp4",
        "not a url",
    ],
)
def test_rejected_urls(url):
    with pytest.raises(UnsafeURLError):
        validate_public_url(url, PUBLIC)


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.8", "169.254.169.254", "192.168.0.2"])
def test_dns_rebinding_to_private_ip_rejected(ip):
    with pytest.raises(UnsafeURLError, match="blocked address"):
        validate_public_url("https://www.youtube.com/watch?v=1", lambda host: ["142.250.80.46", ip])


def test_unresolvable_host_rejected():
    import socket

    def fail(host):
        raise socket.gaierror("nope")

    with pytest.raises(UnsafeURLError, match="resolve"):
        validate_public_url("https://vimeo.com/123", fail)


def test_ensure_safe_url_raises_http_400():
    with pytest.raises(HTTPException) as exc:
        ensure_safe_url("https://www.youtube.com/watch?v=1", lambda host: ["10.0.0.1"])
    assert exc.value.status_code == 400
