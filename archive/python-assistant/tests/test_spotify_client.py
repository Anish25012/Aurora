"""SpotifyClient tests. spotipy is mocked, so no network or Spotify account is needed."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
import requests
import spotipy

from assistant.clients.spotify_client import SpotifyClient, shape_playlist
from assistant.errors import ToolError

TRACK = {
    "type": "track",
    "name": "Teardrop",
    "artists": [{"name": "Massive Attack"}],
    "album": {"name": "Mezzanine", "images": [{"url": "..."}]},
    "duration_ms": 330_000,
    "explicit": False,
    "uri": "spotify:track:abc",
    "available_markets": ["GB"] * 50,  # the kind of noise shaping should drop
}


@pytest.fixture
def sp():
    return MagicMock(spec=spotipy.Spotify)


@pytest.fixture
def client(sp):
    return SpotifyClient(sp)


def test_current_playback_shapes_response(client, sp):
    sp.current_playback.return_value = {
        "is_playing": True,
        "item": TRACK,
        "progress_ms": 61_000,
        "device": {"name": "MacBook", "type": "Computer", "volume_percent": 60, "id": "d1"},
        "shuffle_state": False,
        "repeat_state": "off",
        "context": {"uri": "spotify:playlist:p1"},
    }
    result = client.current_playback()

    assert result["is_playing"] is True
    assert result["item"]["name"] == "Teardrop"
    assert result["item"]["artists"] == ["Massive Attack"]
    assert result["progress"] == "1:01 / 5:30"
    assert result["device"] == {"name": "MacBook", "type": "Computer", "volume_percent": 60}
    assert "available_markets" not in result["item"]


def test_current_playback_nothing_playing(client, sp):
    sp.current_playback.return_value = None  # Spotify sends 204 No Content
    result = client.current_playback()
    assert result["is_playing"] is False
    assert "Nothing is playing" in result["message"]


def test_current_playback_episode(client, sp):
    sp.current_playback.return_value = {
        "is_playing": True,
        "item": {"type": "episode", "name": "Ep 1", "show": {"name": "A Pod"}, "duration_ms": 60_000, "uri": "u"},
        "progress_ms": 0,
    }
    assert client.current_playback()["item"] == {
        "type": "episode", "name": "Ep 1", "show": "A Pod", "duration": "1:00", "uri": "u",
    }


def test_search_multiple_types_and_skips_null_items(client, sp):
    sp.search.return_value = {
        "tracks": {"items": [TRACK]},
        "playlists": {"items": [None, {"name": "Chill", "owner": {"display_name": "Spotify"},
                                       "items": {"total": 80}, "uri": "spotify:playlist:x"}]},
    }
    result = client.search("chill", ["track", "playlist"], limit=5)

    sp.search.assert_called_once_with(q="chill", type="track,playlist", limit=5)
    assert [t["name"] for t in result["tracks"]] == ["Teardrop"]
    assert result["playlists"] == [
        {"type": "playlist", "name": "Chill", "owner": "Spotify", "total_items": 80, "uri": "spotify:playlist:x"}
    ]


def test_search_limit_is_clamped_to_spotify_cap(client, sp):
    sp.search.return_value = {}
    client.search("x", ["track"], limit=50)
    assert sp.search.call_args.kwargs["limit"] == 10


def test_top_tracks_and_artists(client, sp):
    sp.current_user_top_tracks.return_value = {"items": [TRACK]}
    sp.current_user_top_artists.return_value = {"items": [{"name": "Bonobo", "genres": ["downtempo"], "uri": "a"}]}

    assert client.top_items("tracks", "short_term", 10)[0]["name"] == "Teardrop"
    sp.current_user_top_tracks.assert_called_once_with(limit=10, time_range="short_term")
    assert client.top_items("artists", "long_term", 5) == [
        {"type": "artist", "name": "Bonobo", "genres": ["downtempo"], "uri": "a"}
    ]


def test_recently_played_includes_timestamp(client, sp):
    sp.current_user_recently_played.return_value = {
        "items": [{"played_at": "2026-10-21T09:00:00Z", "track": TRACK}]
    }
    (entry,) = client.recently_played(10)
    assert entry["played_at"] == "2026-10-21T09:00:00Z"
    assert entry["name"] == "Teardrop"


def test_playlist_shaping_accepts_old_tracks_field():
    # Older responses used "tracks" instead of "items"; we handle both.
    shaped = shape_playlist({"name": "Old", "owner": {"id": "me"}, "tracks": {"total": 3}, "uri": "u"})
    assert shaped["total_items"] == 3 and shaped["owner"] == "me"


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, "login expired"),
        (403, "User Management"),
        (429, "rate limit"),
        (404, "couldn't find"),
        (500, "Spotify API error 500"),
    ],
)
def test_spotify_errors_become_helpful_tool_errors(client, sp, status, expected):
    sp.current_user_recently_played.side_effect = spotipy.SpotifyException(status, -1, "boom")
    with pytest.raises(ToolError, match=expected):
        client.recently_played(5)


def test_network_errors_become_tool_errors(client, sp):
    sp.current_playback.side_effect = requests.ConnectionError("offline")
    with pytest.raises(ToolError, match="Couldn't reach Spotify"):
        client.current_playback()


def test_ensure_logged_in_uses_auth_manager(sp):
    auth = MagicMock()
    SpotifyClient(sp, auth).ensure_logged_in()
    auth.get_access_token.assert_called_once_with(as_dict=False)


# ---------------------------------------------------------------- playback

def no_device_error():
    return spotipy.SpotifyException(404, -1, "Player command failed: No active device found", reason="NO_ACTIVE_DEVICE")


def test_play_resume_and_specific_tracks(client, sp):
    assert client.play() == {"status": "playing", "what": "resumed playback"}
    sp.start_playback.assert_called_with()

    client.play(uris=["spotify:track:abc"])
    sp.start_playback.assert_called_with(uris=["spotify:track:abc"])

    client.play(context_uri="spotify:playlist:p1")
    sp.start_playback.assert_called_with(context_uri="spotify:playlist:p1")


def test_play_uses_label_from_earlier_results(client, sp):
    sp.search.return_value = {"tracks": {"items": [TRACK]}}
    client.search("teardrop", ["track"])
    assert client.play(uris=["spotify:track:abc"])["what"] == "Teardrop - Massive Attack"


def test_play_falls_back_to_an_available_idle_device(client, sp):
    sp.start_playback.side_effect = [no_device_error(), None]
    sp.devices.return_value = {"devices": [{"id": "dev1", "name": "Phone", "is_active": False, "is_restricted": False}]}

    result = client.play(context_uri="spotify:album:a1")

    assert result["device"] == "Phone"
    sp.start_playback.assert_called_with(device_id="dev1", context_uri="spotify:album:a1")


def test_play_with_no_devices_gives_helpful_message(client, sp):
    sp.start_playback.side_effect = no_device_error()
    sp.devices.return_value = {"devices": []}
    with pytest.raises(ToolError, match="No active Spotify device. Open Spotify"):
        client.play()


def test_pause_with_no_active_device(client, sp):
    sp.pause_playback.side_effect = no_device_error()
    with pytest.raises(ToolError, match="No active Spotify device"):
        client.pause()


def test_premium_required_message(client, sp):
    sp.next_track.side_effect = spotipy.SpotifyException(403, -1, "Premium required", reason="PREMIUM_REQUIRED")
    with pytest.raises(ToolError, match="requires Spotify Premium"):
        client.skip_next()


def test_restriction_violated_message(client, sp):
    sp.pause_playback.side_effect = spotipy.SpotifyException(403, -1, "Player command failed: Restriction violated")
    with pytest.raises(ToolError, match="already paused"):
        client.pause()


def test_skip_previous(client, sp):
    assert client.skip_previous()["status"].startswith("went back")
    sp.previous_track.assert_called_once()


# ------------------------------------------------------ playlists / library

def test_my_playlists_marks_ownership(client, sp):
    sp.current_user.return_value = {"id": "me"}
    sp.current_user_playlists.return_value = {"items": [
        {"name": "Focus", "owner": {"id": "me", "display_name": "Me"}, "items": {"total": 40}, "uri": "spotify:playlist:f"},
        {"name": "Hits", "owner": {"id": "spotify"}, "uri": "spotify:playlist:h"},
    ]}
    result = client.my_playlists()
    assert [(p["name"], p["owned_by_you"]) for p in result] == [("Focus", True), ("Hits", False)]


def test_create_playlist_adds_tracks_in_chunks_of_100(client, sp):
    sp.current_user_playlist_create.return_value = {
        "id": "newid", "uri": "spotify:playlist:newid", "external_urls": {"spotify": "https://open.spotify.com/x"},
    }
    uris = [f"spotify:track:{i:022d}" for i in range(150)]
    result = client.create_playlist("Gym", "Lift heavy", uris)

    sp.current_user_playlist_create.assert_called_once_with(name="Gym", public=False, description="Lift heavy")
    chunks = [c.args[1] for c in sp.playlist_add_items.call_args_list]
    assert [len(c) for c in chunks] == [100, 50]
    assert result["tracks_added"] == 150 and result["url"] == "https://open.spotify.com/x"


def test_create_playlist_reports_partial_failure(client, sp):
    sp.current_user_playlist_create.return_value = {"id": "newid", "uri": "spotify:playlist:newid"}
    sp.playlist_add_items.side_effect = spotipy.SpotifyException(500, -1, "oops")
    with pytest.raises(ToolError, match="Created playlist 'Gym'.*adding tracks failed"):
        client.create_playlist("Gym", "", ["spotify:track:abc"])


def test_add_to_playlist_not_owned(client, sp):
    sp.playlist_add_items.side_effect = spotipy.SpotifyException(403, -1, "Forbidden")
    with pytest.raises(ToolError, match="only add to playlists you own"):
        client.add_to_playlist("p1", ["spotify:track:abc"])


def test_save_to_library_splits_tracks_and_albums(client, sp):
    result = client.save_to_library(["spotify:track:t1", "spotify:album:a1", "spotify:track:t2"])
    sp.current_user_saved_tracks_add.assert_called_once_with(["spotify:track:t1", "spotify:track:t2"])
    sp.current_user_saved_albums_add.assert_called_once_with(["spotify:album:a1"])
    assert result == {"status": "saved", "tracks": 2, "albums": 1}


# ---------------------------------------------------------- preview labels

def test_describe_uris_uses_cache_then_looks_up_then_flags_unknown(client, sp):
    sp.current_user_top_tracks.return_value = {"items": [TRACK]}
    client.top_items("tracks", "short_term", 1)  # caches spotify:track:abc

    def fake_track_lookup(track_id):
        if track_id == "known":
            return {**TRACK, "name": "Angel", "uri": "spotify:track:known"}
        raise spotipy.SpotifyException(404, -1, "not found")

    sp.track.side_effect = fake_track_lookup

    labels = client.describe_uris(["spotify:track:abc", "spotify:track:known", "spotify:track:fake"])

    assert labels[0] == "Teardrop - Massive Attack"
    assert labels[1] == "Angel - Massive Attack"
    assert "may not exist" in labels[2]
    assert sp.track.call_count == 2  # the cached one wasn't looked up


def test_playlist_name_lookup(client, sp):
    sp.playlist.return_value = {"name": "Focus"}
    assert client.playlist_name("p1") == "playlist 'Focus'"
    assert client.playlist_name("p1") == "playlist 'Focus'"
    sp.playlist.assert_called_once_with("p1", fields="name")


# -------------------------------------------------------------- queue / UI

def test_add_to_queue_with_idle_device_fallback(client, sp):
    sp.add_to_queue.side_effect = [no_device_error(), None]
    sp.devices.return_value = {"devices": [{"id": "dev1", "name": "Laptop", "is_restricted": False}]}
    result = client.add_to_queue("spotify:track:abc")
    assert result["status"] == "queued" and result["device"] == "Laptop"
    sp.add_to_queue.assert_called_with("spotify:track:abc", device_id="dev1")


def test_now_playing_for_ui_keeps_art_and_link(client, sp):
    sp.current_playback.return_value = {
        "is_playing": True, "progress_ms": 1000, "device": {"name": "Phone"},
        "item": {**TRACK, "external_urls": {"spotify": "https://open.spotify.com/track/abc"},
                 "album": {"name": "Mezzanine", "images": [{"url": "https://i.scdn.co/big"}]}},
    }
    np = client.now_playing()
    assert np["image_url"] == "https://i.scdn.co/big"
    assert np["spotify_url"] == "https://open.spotify.com/track/abc"
    assert np["subtitle"] == "Massive Attack"


def test_now_playing_nothing(client, sp):
    sp.current_playback.return_value = None
    assert client.now_playing() is None


def test_up_next(client, sp):
    sp.queue.return_value = {"queue": [TRACK, None, TRACK]}
    assert [q["name"] for q in client.up_next(limit=5)] == ["Teardrop", "Teardrop"]
