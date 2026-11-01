from __future__ import annotations

from unittest.mock import MagicMock

from assistant.config import Settings
from assistant.llm import FALLBACK_BETA, AnthropicLLM


def call(settings: Settings, **extra):
    client = MagicMock()
    AnthropicLLM(settings, client=client).create(system="sys", messages=[], tools=[], **extra)
    return client


def test_fallback_capable_model_uses_beta_endpoint_with_default_fallbacks():
    client = call(Settings(anthropic_api_key="k", model="claude-sonnet-5-5"))
    kwargs = client.beta.messages.create.call_args.kwargs
    assert kwargs["betas"] == [FALLBACK_BETA]
    assert kwargs["fallbacks"] == "default"
    assert kwargs["model"] == "claude-sonnet-5-5"
    assert kwargs["output_config"] == {"effort": "medium"}
    assert "tool_choice" not in kwargs
    client.messages.create.assert_not_called()


def test_fallback_disabled_uses_standard_endpoint():
    client = call(Settings(anthropic_api_key="k", refusal_fallback=False))
    kwargs = client.messages.create.call_args.kwargs
    assert "fallbacks" not in kwargs and "betas" not in kwargs
    client.beta.messages.create.assert_not_called()


def test_unsupported_model_skips_fallback():
    client = call(Settings(anthropic_api_key="k", model="claude-haiku-5-5"))
    client.messages.create.assert_called_once()


def test_tool_choice_passed_through():
    client = call(Settings(anthropic_api_key="k"), tool_choice={"type": "none"})
    assert client.beta.messages.create.call_args.kwargs["tool_choice"] == {"type": "none"}
