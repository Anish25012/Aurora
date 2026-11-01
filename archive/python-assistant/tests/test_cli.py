"""CLI-level tests: the y/n confirmation prompt and basic wiring."""

from __future__ import annotations

import pytest

from assistant import main
from assistant.config import ConfigError
from assistant.safety import PendingAction

ACTION = PendingAction("create_playlist", "Create a private playlist 'Gym' with 12 tracks",
                       ["Teardrop - Massive Attack", "Song [Remix] - Artist"])


@pytest.mark.parametrize(("typed", "approved"), [
    ("y", True), ("YES", True), ("n", False), ("", False), ("sure", False),
])
def test_only_explicit_yes_approves(monkeypatch, typed, approved):
    monkeypatch.setattr(main.console, "input", lambda prompt="": typed)
    assert main.CliConfirmer()(ACTION) is approved


def test_ctrl_c_at_prompt_counts_as_no(monkeypatch):
    def interrupt(prompt=""):
        raise KeyboardInterrupt

    monkeypatch.setattr(main.console, "input", interrupt)
    assert main.CliConfirmer()(ACTION) is False


def test_preview_shows_every_track_and_escapes_markup(monkeypatch):
    monkeypatch.setattr(main.console, "input", lambda prompt="": "n")
    with main.console.capture() as captured:
        main.CliConfirmer()(ACTION)
    output = captured.get()
    assert "Gym" in output and "Teardrop - Massive Attack" in output
    assert "Song [Remix] - Artist" in output  # not swallowed as rich markup


def test_main_exits_cleanly_on_config_error(monkeypatch):
    def bad_config():
        raise ConfigError("ANTHROPIC_API_KEY is not set.")

    monkeypatch.setattr(main, "load_settings", bad_config)
    assert main.main() == 1
