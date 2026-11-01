"""Spotify tools, end to end through the registry, with the client mocked."""

from __future__ import annotations

import json
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest

from assistant.clients.spotify_client import SpotifyClient
from assistant.errors import ToolError
from assistant.safety import approve_all, deny_all
from assistant.tools import build_registry

SPOTIFY_TOOLS = [
    "get_current_playback", "search", "get_top_items", "get_recently_played", "get_my_playlists",
    "play", "add_to_queue", "pause", "skip_next", "skip_previous", "create_playlist", "add_to_playlist", "save_to_library",
]


def track_uri(i: int) -> str:
    return f"spotify:track:{i:022d}"


PLAYLIST_ID = "37i9dQZF1DXcBWIGoYBM5M"


@pytest.fixture
def client():
    c = MagicMock(spec=SpotifyClient)
    c.describe_uris.side_effect = lambda uris: [f"Song {u[-2:]}" for u in uris]
    c.playlist_name.return_value = "playlist 'Focus'"
    return c


def make_registry(client, confirmer=approve_all, threshold=10):
    return build_registry(ZoneInfo("Europe/London"), spotify=client, confirmer=confirmer,
                          playlist_confirm_threshold=threshold)


@pytest.fixture
def registry(client):
    return make_registry(client)


# ------------------------------------------------------------------ wiring

def test_spotify_tools_registered_only_when_configured(registry):
    assert registry.names() == ["get_time", *SPOTIFY_TOOLS]
    assert build_registry(ZoneInfo("Europe/London")).names() == ["get_time"]


def test_every_tool_has_description_and_object_schema(registry):
    for definition in registry.definitions():
        assert len(definition["description"]) > 20
        assert definition["input_schema"]["type"] == "object"


# -------------------------------------------------------------------- read

def test_get_current_playback(registry, client):
    client.current_playback.return_value = {"is_playing": False, "message": "Nothing is playing."}
    result = registry.execute("get_current_playback", {})
    assert not result.is_error
    assert json.loads(result.content)["is_playing"] is False


def test_search_defaults(registry, client):
    client.search.return_value = {"tracks": []}
    registry.execute("search", {"query": "lofi beats"})
    client.search.assert_called_once_with("lofi beats", ["track"], 5)


def test_search_rejects_bad_type_and_over_limit(registry, client):
    assert registry.execute("search", {"query": "x", "types": ["podcast"]}).is_error
    assert registry.execute("search", {"query": "x", "limit": 11}).is_error
    assert registry.execute("search", {"query": ""}).is_error
    client.search.assert_not_called()


def test_get_top_items(registry, client):
    client.top_items.return_value = []
    registry.execute("get_top_items", {"kind": "artists", "time_range": "short_term", "limit": 5})
    client.top_items.assert_called_once_with("artists", "short_term", 5)


def test_get_top_items_requires_kind(registry, client):
    assert registry.execute("get_top_items", {}).is_error


def test_get_recently_played(registry, client):
    client.recently_played.return_value = []
    registry.execute("get_recently_played", {"limit": 3})
    client.recently_played.assert_called_once_with(3)


def test_get_my_playlists(registry, client):
    client.my_playlists.return_value = []
    registry.execute("get_my_playlists", {})
    client.my_playlists.assert_called_once_with(50)


def test_client_tool_error_reaches_model(registry, client):
    client.current_playback.side_effect = ToolError("Spotify's rate limit was hit.")
    result = registry.execute("get_current_playback", {})
    assert result.is_error and "rate limit" in result.content


# ---------------------------------------------------------------- playback

def test_play_variants(registry, client):
    client.play.return_value = {"status": "playing"}
    registry.execute("play", {})
    client.play.assert_called_with(None, None)
    registry.execute("play", {"context_uri": f"spotify:playlist:{PLAYLIST_ID}"})
    client.play.assert_called_with(None, f"spotify:playlist:{PLAYLIST_ID}")
    registry.execute("play", {"uris": [track_uri(1)]})
    client.play.assert_called_with([track_uri(1)], None)


@pytest.mark.parametrize("args", [
    {"uris": ["not-a-uri"]},
    {"uris": ["spotify:track:short"]},
    {"context_uri": "spotify:track:" + "a" * 22},           # a track isn't a context
    {"uris": [track_uri(1)], "context_uri": f"spotify:album:{PLAYLIST_ID}"},  # not both
])
def test_play_rejects_invalid_arguments(registry, client, args):
    assert registry.execute("play", args).is_error
    client.play.assert_not_called()


@pytest.mark.parametrize("name", ["pause", "skip_next", "skip_previous"])
def test_simple_controls(registry, client, name):
    getattr(client, name).return_value = {"status": "ok"}
    assert not registry.execute(name, {}).is_error
    getattr(client, name).assert_called_once()


# ---------------------------------------------------- playlist confirmation

def test_small_playlist_is_created_without_confirmation(client):
    confirmer = MagicMock(return_value=False)
    registry = make_registry(client, confirmer=confirmer)
    client.create_playlist.return_value = {"status": "created"}

    registry.execute("create_playlist", {"name": "Short", "track_uris": [track_uri(i) for i in range(10)]})

    confirmer.assert_not_called()
    client.create_playlist.assert_called_once()


def test_large_playlist_needs_confirmation_and_shows_tracks(client):
    seen = []
    registry = make_registry(client, confirmer=lambda action: seen.append(action) or True)
    client.create_playlist.return_value = {"status": "created"}

    registry.execute("create_playlist", {"name": "Gym", "track_uris": [track_uri(i) for i in range(20)]})

    (action,) = seen
    assert action.summary == "Create a private playlist 'Gym' with 20 tracks"
    assert len(action.details) == 20 and action.details[0] == "Song 00"
    client.create_playlist.assert_called_once_with("Gym", "", [track_uri(i) for i in range(20)], False)


def test_declined_playlist_is_not_created(client):
    registry = make_registry(client, confirmer=deny_all)
    result = registry.execute("create_playlist", {"name": "Gym", "track_uris": [track_uri(i) for i in range(20)]})
    assert result.declined
    client.create_playlist.assert_not_called()


def test_add_to_playlist_confirmation_names_the_playlist(client):
    seen = []
    registry = make_registry(client, confirmer=lambda a: seen.append(a) or False)
    registry.execute("add_to_playlist", {"playlist": f"spotify:playlist:{PLAYLIST_ID}",
                                         "track_uris": [track_uri(i) for i in range(11)]})
    assert seen[0].summary == "Add 11 tracks to playlist 'Focus'"
    client.playlist_name.assert_called_once_with(PLAYLIST_ID)
    client.add_to_playlist.assert_not_called()


def test_add_single_song_runs_immediately_and_accepts_bare_id(registry, client):
    client.add_to_playlist.return_value = {"status": "added"}
    registry.execute("add_to_playlist", {"playlist": PLAYLIST_ID, "track_uris": [track_uri(1)]})
    client.add_to_playlist.assert_called_once_with(PLAYLIST_ID, [track_uri(1)])


def test_threshold_zero_confirms_every_change(client):
    confirmer = MagicMock(return_value=False)
    registry = make_registry(client, confirmer=confirmer, threshold=0)
    registry.execute("add_to_playlist", {"playlist": PLAYLIST_ID, "track_uris": [track_uri(1)]})
    confirmer.assert_called_once()


def test_add_to_playlist_rejects_bad_playlist_id(registry, client):
    assert registry.execute("add_to_playlist", {"playlist": "Focus", "track_uris": [track_uri(1)]}).is_error


# ------------------------------------------------------------------ library

def test_save_to_library(registry, client):
    client.save_to_library.return_value = {"status": "saved"}
    uris = [track_uri(1), f"spotify:album:{PLAYLIST_ID}"]
    registry.execute("save_to_library", {"uris": uris})
    client.save_to_library.assert_called_once_with(uris)


def test_save_to_library_rejects_playlists(registry, client):
    assert registry.execute("save_to_library", {"uris": [f"spotify:playlist:{PLAYLIST_ID}"]}).is_error


def test_add_to_queue(registry, client):
    client.add_to_queue.return_value = {"status": "queued"}
    registry.execute("add_to_queue", {"uri": track_uri(7)})
    client.add_to_queue.assert_called_once_with(track_uri(7))


def test_add_to_queue_rejects_albums(registry, client):
    assert registry.execute("add_to_queue", {"uri": f"spotify:album:{PLAYLIST_ID}"}).is_error
    client.add_to_queue.assert_not_called()
