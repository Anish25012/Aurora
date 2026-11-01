"""Smoke tests for the Streamlit UI using Streamlit's headless AppTest runner.

The real LLM is swapped for the scripted FakeLLM, and Spotify is left
unconfigured, so these run offline.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

import assistant.llm
from tests.fakes import FakeLLM, response, text_block, tool_use_block

APP = str(Path(__file__).parents[1] / "assistant" / "ui" / "streamlit_app.py")


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    for name in ("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"):
        monkeypatch.setenv(name, "")


def use_fake_llm(monkeypatch, *responses):
    fake = FakeLLM(*responses)
    monkeypatch.setattr(assistant.llm, "AnthropicLLM", lambda settings: fake)
    return fake


def wait_for_reply(at: AppTest, attempts: int = 20) -> None:
    # The turn runs on a worker thread. Re-run the script until it's been picked up.
    session = at.session_state["aurora"]
    for _ in range(attempts):
        if session.turn is not None:
            session.turn.wait(2)
        at.run()
        if session.turn is None:
            return
    raise AssertionError("turn never finished")


def test_page_renders_without_spotify(env, monkeypatch):
    use_fake_llm(monkeypatch)
    at = AppTest.from_file(APP, default_timeout=10).run()

    assert not at.exception
    assert any("Spotify isn't connected" in i.value for i in at.info)
    assert [b.label for b in at.button if "playlist" in b.label]  # example prompts shown


def test_chat_round_trip_shows_answer_and_tool_calls(env, monkeypatch):
    use_fake_llm(
        monkeypatch,
        response(tool_use_block("get_time", {"timezone": "Asia/Tokyo"})),
        response(text_block("It's late evening in Tokyo.")),
    )
    at = AppTest.from_file(APP, default_timeout=10).run()
    at.chat_input[0].set_value("What time is it in Tokyo?").run()
    wait_for_reply(at)

    assert not at.exception
    texts = [m.value for m in at.markdown]
    assert "What time is it in Tokyo?" in texts
    assert "It's late evening in Tokyo." in texts
    assert any("1 tool call" in e.label for e in at.expander)


def test_config_error_is_shown(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setattr("assistant.config.load_dotenv", lambda *a, **k: None)
    at = AppTest.from_file(APP, default_timeout=10).run()
    assert any("ANTHROPIC_API_KEY" in e.value for e in at.error)


def add_gated_tool(monkeypatch, func):
    """Wrap build_registry to add a tool that always needs confirmation."""
    from pydantic import BaseModel, ConfigDict

    import assistant.tools
    from assistant.safety import PendingAction
    from assistant.tools.registry import Tool

    class NoArgs(BaseModel):
        model_config = ConfigDict(extra="forbid")

    real_build = assistant.tools.build_registry

    def build(*args, **kwargs):
        registry = real_build(*args, **kwargs)
        registry.register(Tool("risky", "A risky action for tests.", NoArgs, func,
                               confirmation=lambda a: PendingAction("risky", "Do the risky thing", ["step one"])))
        return registry

    monkeypatch.setattr(assistant.tools, "build_registry", build)


@pytest.mark.parametrize(("button", "should_run"), [("Approve", True), ("Cancel", False)])
def test_confirmation_buttons_gate_the_action(env, monkeypatch, button, should_run):
    ran = []
    add_gated_tool(monkeypatch, lambda a: ran.append(True) or {"ok": True})
    use_fake_llm(monkeypatch, response(tool_use_block("risky", {})), response(text_block("Finished.")))

    at = AppTest.from_file(APP, default_timeout=10).run()
    at.chat_input[0].set_value("do the risky thing").run()

    session = at.session_state["aurora"]
    for _ in range(40):  # wait for the worker thread to reach the gate
        if session.confirmer.pending:
            break
        session.turn.wait(0.05)
    at.run()
    assert any("Do the risky thing" in m.value for m in at.markdown)
    assert not ran  # nothing happens until a button is clicked

    next(b for b in at.button if b.label == button).click().run()
    wait_for_reply(at)

    assert bool(ran) is should_run
    assert any(m.value == "Finished." for m in at.markdown)
