"""Application settings, loaded from environment variables (and .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv

DEFAULT_MODEL = "claude-sonnet-5-5"
VALID_EFFORTS = ("low", "medium", "high", "xhigh", "max")
# Spotify no longer accepts "localhost" in redirect URIs. Loopback redirects
# must use the literal IP 127.0.0.1 (plain http is allowed only for loopback).
DEFAULT_SPOTIFY_REDIRECT_URI = "http://127.0.0.1:8888/callback"


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    # frozen=True: settings are read once at startup and passed around
    # explicitly, so nothing can mutate config mid-session.
    anthropic_api_key: str
    model: str = DEFAULT_MODEL
    effort: str = "medium"
    max_tool_iterations: int = 10
    max_tokens: int = 16000
    refusal_fallback: bool = True
    # Playlist changes with more than this many tracks need a y/n confirmation.
    playlist_confirm_threshold: int = 10
    timezone: str = "Europe/London"
    log_level: str = "WARNING"
    # Spotify is optional: without credentials, Aurora still runs, just without
    # music tools. That keeps the project usable (and testable) piece by piece.
    spotify_client_id: str | None = None
    spotify_client_secret: str | None = None
    spotify_redirect_uri: str = DEFAULT_SPOTIFY_REDIRECT_URI
    spotify_cache_path: str = ".spotify_cache"

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def spotify_configured(self) -> bool:
        return bool(self.spotify_client_id and self.spotify_client_secret)


def load_settings(env_file: str | None = ".env") -> Settings:
    """Build Settings from the environment, failing fast with a clear message."""
    if env_file:
        # override=False: real environment variables win over .env, which is
        # the usual convention (and what CI/hosting platforms expect).
        load_dotenv(env_file, override=False)

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise ConfigError(
            "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key."
        )

    effort = os.getenv("ASSISTANT_EFFORT", "medium").strip().lower()
    if effort not in VALID_EFFORTS:
        raise ConfigError(f"ASSISTANT_EFFORT must be one of {VALID_EFFORTS}, got {effort!r}.")

    try:
        max_iters = int(os.getenv("MAX_TOOL_ITERATIONS", "10"))
    except ValueError as exc:
        raise ConfigError("MAX_TOOL_ITERATIONS must be an integer.") from exc
    if max_iters < 1:
        raise ConfigError("MAX_TOOL_ITERATIONS must be at least 1.")

    try:
        confirm_threshold = int(os.getenv("PLAYLIST_CONFIRM_THRESHOLD", "10"))
    except ValueError as exc:
        raise ConfigError("PLAYLIST_CONFIRM_THRESHOLD must be an integer.") from exc
    if confirm_threshold < 0:
        raise ConfigError("PLAYLIST_CONFIRM_THRESHOLD can't be negative (use 0 to confirm every change).")

    timezone = os.getenv("USER_TIMEZONE", "Europe/London").strip()
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ConfigError(f"USER_TIMEZONE {timezone!r} is not a valid IANA timezone.") from exc

    redirect_uri = os.getenv("SPOTIFY_REDIRECT_URI", "").strip() or DEFAULT_SPOTIFY_REDIRECT_URI
    if "localhost" in redirect_uri:
        raise ConfigError(
            "SPOTIFY_REDIRECT_URI can't use 'localhost' (Spotify rejects it). "
            f"Use {DEFAULT_SPOTIFY_REDIRECT_URI} instead, in both .env and the Spotify dashboard."
        )

    return Settings(
        spotify_client_id=os.getenv("SPOTIFY_CLIENT_ID", "").strip() or None,
        spotify_client_secret=os.getenv("SPOTIFY_CLIENT_SECRET", "").strip() or None,
        spotify_redirect_uri=redirect_uri,
        spotify_cache_path=os.getenv("SPOTIFY_CACHE_PATH", "").strip() or ".spotify_cache",
        anthropic_api_key=api_key,
        model=os.getenv("ASSISTANT_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        effort=effort,
        max_tool_iterations=max_iters,
        playlist_confirm_threshold=confirm_threshold,
        refusal_fallback=_env_bool("ASSISTANT_REFUSAL_FALLBACK", True),
        timezone=timezone,
        log_level=os.getenv("LOG_LEVEL", "WARNING").strip().upper(),
    )
