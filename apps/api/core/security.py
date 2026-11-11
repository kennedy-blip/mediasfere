"""SSRF protection: hostname allowlist plus DNS-resolved IP sandbox."""

import ipaddress
import socket
from collections.abc import Callable, Iterable
from urllib.parse import urlsplit

from fastapi import HTTPException, status

from core.config import get_settings

BLOCKED_NETWORKS = [
    ipaddress.ip_network(cidr)
    for cidr in (
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "169.254.169.254/32",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "::/128",
        "::1/128",
        "fc00::/7",
        "fe80::/10",
        "fd00:ec2::254/128",
    )
]

Resolver = Callable[[str], Iterable[str]]


class UnsafeURLError(ValueError):
    pass


def default_resolver(hostname: str) -> list[str]:
    infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    return sorted({info[4][0] for info in infos})


def is_ip_blocked(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%", 1)[0])
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    if (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    ):
        return True
    return any(addr in net for net in BLOCKED_NETWORKS if net.version == addr.version)


def is_allowed_host(hostname: str, allowed: Iterable[str] | None = None) -> bool:
    hostname = hostname.lower().rstrip(".")
    domains = allowed if allowed is not None else get_settings().allowed_domains
    return any(hostname == d or hostname.endswith("." + d) for d in domains)


def validate_public_url(url: str, resolver: Resolver = default_resolver) -> str:
    """Return the normalized URL or raise UnsafeURLError."""
    try:
        parts = urlsplit(url.strip())
    except ValueError as exc:
        raise UnsafeURLError("Malformed URL") from exc

    if parts.scheme not in ("http", "https"):
        raise UnsafeURLError("Only http(s) URLs are allowed")
    if parts.username or parts.password:
        raise UnsafeURLError("Credentials in URL are not allowed")
    hostname = parts.hostname
    if not hostname:
        raise UnsafeURLError("URL has no hostname")
    if parts.port not in (None, 80, 443):
        raise UnsafeURLError("Non-standard ports are not allowed")

    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise UnsafeURLError("Raw IP addresses are not allowed")

    if not is_allowed_host(hostname):
        raise UnsafeURLError(f"Unsupported platform: {hostname}")

    try:
        ips = list(resolver(hostname))
    except (socket.gaierror, UnicodeError) as exc:
        raise UnsafeURLError(f"Could not resolve {hostname}") from exc
    if not ips:
        raise UnsafeURLError(f"Could not resolve {hostname}")
    for ip in ips:
        if is_ip_blocked(ip):
            raise UnsafeURLError(f"{hostname} resolves to a blocked address")

    return parts.geturl()


def ensure_safe_url(url: str, resolver: Resolver = default_resolver) -> str:
    try:
        return validate_public_url(url, resolver)
    except UnsafeURLError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
