"""The only module that talks to the Anthropic API.

The agent depends on the small `LLM` protocol below rather than on the SDK
directly. That makes the agent loop testable with a scripted fake model (no
network, no API key, deterministic) and keeps SDK details in one place.
"""

from __future__ import annotations

from typing import Any, Protocol

import anthropic

from assistant.config import Settings

# Server-side refusal fallback: if Claude's safety classifier declines a request,
# the API re-runs it on a recommended fallback model instead of returning a
# refusal. Only some models accept the parameter, so we gate on the model name.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FALLBACK_CAPABLE_MODELS = frozenset(
    {"claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"}
)


def explain_api_error(exc: anthropic.APIError) -> str:
    """A user-facing message for an Anthropic API failure (shared by CLI and web UI)."""
    # Most specific first: each case needs a different fix from the user.
    if isinstance(exc, anthropic.AuthenticationError):
        return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env."
    if isinstance(exc, anthropic.NotFoundError):
        return "Model not found. Check ASSISTANT_MODEL in .env."
    if isinstance(exc, anthropic.RateLimitError):
        return "Rate limited by the Anthropic API. Wait a moment and try again."
    if isinstance(exc, anthropic.APIStatusError):
        return f"Anthropic API error ({exc.status_code}): {exc.message}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "Couldn't reach the Anthropic API. Check your internet connection."
    return f"Anthropic API error: {exc}"


class LLM(Protocol):
    def create(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: dict[str, Any] | None = None,
    ) -> Any:
        """Send one Messages API request and return the response message."""
        ...


class AnthropicLLM:
    def __init__(self, settings: Settings, client: anthropic.Anthropic | None = None) -> None:
        self._settings = settings
        # max_retries: the SDK already retries 429/5xx/connection errors with
        # exponential backoff; 3 is a touch more patient than the default of 2.
        self._client = client or anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=3)
        self._use_fallback = settings.refusal_fallback and settings.model in FALLBACK_CAPABLE_MODELS

    def create(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: dict[str, Any] | None = None,
    ) -> Any:
        kwargs: dict[str, Any] = {
            "model": self._settings.model,
            "max_tokens": self._settings.max_tokens,
            "system": system,
            "messages": messages,
            "tools": tools,
            # Effort controls how much the model thinks before acting. Thinking is
            # adaptive by default on current models, so this is the main dial for
            # trading answer quality against latency and cost.
            "output_config": {"effort": self._settings.effort},
        }
        if tool_choice is not None:
            kwargs["tool_choice"] = tool_choice

        if self._use_fallback:
            return self._client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
        return self._client.messages.create(**kwargs)
