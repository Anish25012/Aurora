from __future__ import annotations

import pytest

from assistant.config import DEFAULT_MODEL, ConfigError, load_settings

ENV_VARS = [
    "ANTHROPIC_API_KEY", "ASSISTANT_MODEL", "ASSISTANT_EFFORT", "MAX_TOOL_ITERATIONS",
    "ASSISTANT_REFUSAL_FALLBACK", "USER_TIMEZONE", "LOG_LEVEL",
    "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REDIRECT_URI", "SPOTIFY_CACHE_PATH",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_defaults(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    s = load_settings(env_file=None)
    assert s.model == DEFAULT_MODEL
    assert s.effort == "medium"
    assert s.max_tool_iterations == 10
    assert s.timezone == "Europe/London"
    assert s.refusal_fallback is True


def test_missing_api_key_fails_fast():
    with pytest.raises(ConfigError, match="ANTHROPIC_API_KEY"):
        load_settings(env_file=None)


@pytest.mark.parametrize(
    ("name", "value"),
    [("ASSISTANT_EFFORT", "turbo"), ("MAX_TOOL_ITERATIONS", "zero"), ("MAX_TOOL_ITERATIONS", "0"),
     ("USER_TIMEZONE", "Narnia/Cair_Paravel")],
)
def test_invalid_values_rejected(monkeypatch, name, value):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigError):
        load_settings(env_file=None)


def test_fallback_can_be_disabled(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ASSISTANT_REFUSAL_FALLBACK", "false")
    assert load_settings(env_file=None).refusal_fallback is False


def test_spotify_optional_and_localhost_redirect_rejected(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert load_settings(env_file=None).spotify_configured is False

    monkeypatch.setenv("SPOTIFY_REDIRECT_URI", "http://localhost:8888/callback")
    with pytest.raises(ConfigError, match="127.0.0.1"):
        load_settings(env_file=None)
