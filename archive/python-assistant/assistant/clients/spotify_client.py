"""Spotify: OAuth login plus a thin wrapper around spotipy.

The wrapper does three jobs:
  1. Auth: Authorization Code flow with a locally cached, auto-refreshed token.
  2. Shaping: Spotify responses are large (images, markets, href links...). We
     reduce them to the handful of fields the model needs. That saves tokens on
     every call and leaves the model less noise to misread.
  3. Errors: spotipy exceptions become ToolErrors whose messages tell the model
     (and so the user) what went wrong and how to fix it.

Endpoint note: Spotify restricted new "Development Mode" apps in Nov 2024 and
again in Feb 2026. Recommendations, audio features, related artists, browse,
artist top tracks, batch lookups and Spotify's editorial playlists are
unavailable, and search returns at most 10 results. Everything used here is on
the still-available list (spotipy 2.26 already calls the renamed endpoints:
/me/library, /me/playlists, /playlists/{id}/items).
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Literal

import requests
import spotipy
from spotipy.cache_handler import CacheFileHandler
from spotipy.oauth2 import SpotifyOAuth, SpotifyOauthError

from assistant.config import Settings
from assistant.errors import ToolError

logger = logging.getLogger(__name__)

# Least privilege: request only the scopes the current tools need. When a scope
# is added, spotipy sees that the cached token doesn't cover it and asks the
# user to approve again, so the user always sees when the app wants more access.
SPOTIFY_SCOPES = (
    "user-read-playback-state",    # get_current_playback; finding an available device; UI queue view
    "user-read-currently-playing", # UI "up next" view (GET /me/player/queue requires it)
    "user-modify-playback-state",  # play / add_to_queue / pause / skip_next / skip_previous
    "user-top-read",               # get_top_items
    "user-read-recently-played",   # get_recently_played
    "playlist-read-private",       # get_my_playlists (includes private playlists)
    "playlist-modify-private",     # create_playlist (private by default), add_to_playlist
    "playlist-modify-public",      # add_to_playlist on public playlists; public create_playlist
    "user-library-modify",         # save_to_library
)

SEARCH_MAX_LIMIT = 10  # Spotify's cap for Development Mode apps since Feb 2026
PLAYLIST_ADD_MAX = 100  # Spotify accepts at most 100 items per add request
TimeRange = Literal["short_term", "medium_term", "long_term"]

NO_DEVICE_MESSAGE = (
    "No active Spotify device. Open Spotify on a phone, computer or speaker (playing "
    "and pausing anything once is enough to make it active), then try again."
)
PREMIUM_MESSAGE = "Controlling playback requires Spotify Premium on this account."


class SpotifyClient:
    def __init__(self, sp: spotipy.Spotify, auth_manager: SpotifyOAuth | None = None) -> None:
        # Taking a ready-made spotipy.Spotify means tests can pass in a mock.
        self._sp = sp
        self._auth = auth_manager
        self._user_id: str | None = None
        # URI -> human label ("Teardrop - Massive Attack") for everything we've
        # returned to the model. Confirmation previews use it to show readable
        # names. The model almost always gets URIs from our own results, so this
        # usually saves extra lookups (and Spotify removed batch lookups for
        # new apps anyway).
        self._labels: dict[str, str] = {}

    @classmethod
    def from_settings(cls, settings: Settings) -> SpotifyClient:
        auth = SpotifyOAuth(
            client_id=settings.spotify_client_id,
            client_secret=settings.spotify_client_secret,
            redirect_uri=settings.spotify_redirect_uri,
            scope=" ".join(SPOTIFY_SCOPES),
            cache_handler=CacheFileHandler(cache_path=settings.spotify_cache_path),
            # With a 127.0.0.1 redirect URI, spotipy opens the browser and runs a
            # one-shot local web server to catch the redirect. No copy-pasting
            # URLs needed.
            open_browser=True,
        )
        sp = spotipy.Spotify(
            auth_manager=auth,
            requests_timeout=10,
            # Don't auto-retry 429s. Spotify can send a Retry-After of minutes or
            # more, and silently sleeping would freeze the chat. Fail fast and
            # let the assistant tell the user instead.
            status_forcelist=(500, 502, 503, 504),
            retries=2,
        )
        return cls(sp, auth)

    def ensure_logged_in(self) -> None:
        """Log in now (opening the browser if needed) rather than mid-conversation.

        The first run opens Spotify's consent page. After that, the cached refresh
        token is used silently. If the requested scopes have changed since the token
        was cached, spotipy notices and asks for consent again.
        """
        if self._auth is None:
            return
        try:
            self._auth.get_access_token(as_dict=False)
        except SpotifyOauthError as exc:
            raise ToolError(f"Spotify login failed: {exc}") from exc

    # ------------------------------------------------------------------ reads

    def current_playback(self) -> dict[str, Any]:
        data = self._call(self._sp.current_playback, additional_types="track,episode")
        # Spotify returns 204 No Content (None) when nothing is active.
        if not data or not data.get("item"):
            return {"is_playing": False, "message": "Nothing is playing on Spotify right now."}

        item = data["item"]
        shaped_item = shape_episode(item) if item.get("type") == "episode" else shape_track(item)
        self._remember([shaped_item])
        device = data.get("device") or {}
        context = data.get("context") or {}
        return {
            "is_playing": bool(data.get("is_playing")),
            "item": shaped_item,
            "progress": f"{_mmss(data.get('progress_ms'))} / {_mmss(item.get('duration_ms'))}",
            "device": {
                "name": device.get("name"),
                "type": device.get("type"),
                "volume_percent": device.get("volume_percent"),
            },
            "shuffle": data.get("shuffle_state"),
            "repeat": data.get("repeat_state"),
            "context_uri": context.get("uri"),
        }

    def search(self, query: str, types: list[str], limit: int = 5) -> dict[str, list[dict[str, Any]]]:
        limit = max(1, min(limit, SEARCH_MAX_LIMIT))
        data = self._call(self._sp.search, q=query, type=",".join(types), limit=limit)
        shapers = {"track": shape_track, "artist": shape_artist, "album": shape_album, "playlist": shape_playlist}
        results: dict[str, list[dict[str, Any]]] = {}
        for kind in types:
            items = (data.get(f"{kind}s") or {}).get("items") or []
            # Spotify sometimes returns null entries in search results (notably
            # for playlists), so filter them out rather than crash.
            results[f"{kind}s"] = self._remember([shapers[kind](i) for i in items if i])
        return results

    def top_items(self, kind: Literal["tracks", "artists"], time_range: TimeRange, limit: int) -> list[dict]:
        if kind == "tracks":
            data = self._call(self._sp.current_user_top_tracks, limit=limit, time_range=time_range)
            return self._remember([shape_track(t) for t in data.get("items", []) if t])
        data = self._call(self._sp.current_user_top_artists, limit=limit, time_range=time_range)
        return self._remember([shape_artist(a) for a in data.get("items", []) if a])

    def recently_played(self, limit: int) -> list[dict[str, Any]]:
        data = self._call(self._sp.current_user_recently_played, limit=limit)
        return self._remember([
            {"played_at": entry.get("played_at"), **shape_track(entry["track"])}
            for entry in data.get("items", [])
            if entry and entry.get("track")
        ])

    def my_playlists(self, limit: int = 50) -> list[dict[str, Any]]:
        me = self._current_user_id()
        data = self._call(self._sp.current_user_playlists, limit=limit)
        return self._remember([
            {**shape_playlist(p), "owned_by_you": (p.get("owner") or {}).get("id") == me}
            for p in data.get("items", [])
            if p
        ])

    # --------------------------------------------------------------- playback

    def play(self, uris: list[str] | None = None, context_uri: str | None = None) -> dict[str, Any]:
        """Resume (no args), play specific tracks, or play an album/artist/playlist."""
        kwargs: dict[str, Any] = {}
        if uris:
            kwargs["uris"] = uris
        if context_uri:
            kwargs["context_uri"] = context_uri
        device = self._with_device_fallback(self._sp.start_playback, **kwargs)
        result = {"status": "playing", "what": self._what(uris, context_uri)}
        if device:
            result["device"] = device
        return result

    def add_to_queue(self, uri: str) -> dict[str, Any]:
        device = self._with_device_fallback(self._sp.add_to_queue, uri)
        result = {"status": "queued", "what": self._what([uri], None)}
        if device:
            result["device"] = device
        return result

    def pause(self) -> dict[str, str]:
        self._call(self._sp.pause_playback)
        return {"status": "paused"}

    def skip_next(self) -> dict[str, str]:
        self._call(self._sp.next_track)
        return {"status": "skipped to next track"}

    def skip_previous(self) -> dict[str, str]:
        self._call(self._sp.previous_track)
        return {"status": "went back to previous track"}

    # ----------------------------------------------------- playlists / library

    def create_playlist(
        self, name: str, description: str, track_uris: list[str], public: bool = False
    ) -> dict[str, Any]:
        playlist = self._call(
            self._sp.current_user_playlist_create, name=name, public=public, description=description
        )
        try:
            self._add_in_chunks(playlist["id"], track_uris)
        except ToolError as exc:
            # Don't hide a half-done job: say the playlist exists but is empty,
            # so the model can retry the add rather than create a duplicate.
            raise ToolError(
                f"Created playlist '{name}' ({playlist.get('uri')}) but adding tracks failed: {exc}"
            ) from exc
        self._labels[playlist["uri"]] = f"playlist '{name}'"
        return {
            "status": "created",
            "name": name,
            "uri": playlist.get("uri"),
            "url": (playlist.get("external_urls") or {}).get("spotify"),
            "tracks_added": len(track_uris),
            "public": public,
        }

    def add_to_playlist(self, playlist_id: str, track_uris: list[str]) -> dict[str, Any]:
        self._add_in_chunks(playlist_id, track_uris)
        return {"status": "added", "playlist_uri": f"spotify:playlist:{playlist_id}", "tracks_added": len(track_uris)}

    def save_to_library(self, uris: list[str]) -> dict[str, Any]:
        tracks = [u for u in uris if u.startswith("spotify:track:")]
        albums = [u for u in uris if u.startswith("spotify:album:")]
        if tracks:
            self._call(self._sp.current_user_saved_tracks_add, tracks)
        if albums:
            self._call(self._sp.current_user_saved_albums_add, albums)
        return {"status": "saved", "tracks": len(tracks), "albums": len(albums)}

    # ------------------------------------------------------ preview helpers

    def describe_uris(self, uris: list[str]) -> list[str]:
        """Human-readable labels for URIs, for confirmation previews."""
        return [self._label_for(uri) for uri in uris]

    def playlist_name(self, playlist_id: str) -> str:
        uri = f"spotify:playlist:{playlist_id}"
        if uri not in self._labels:
            data = self._call(self._sp.playlist, playlist_id, fields="name")
            self._labels[uri] = f"playlist '{data.get('name')}'"
        return self._labels[uri]

    # ------------------------------------------------------- UI-only views
    # These feed the web UI's "now playing" panel, never the model. They keep
    # the cover art and the open.spotify.com links. Spotify's developer policy
    # requires showing cover art and linking back to Spotify wherever its
    # content is displayed, but the model doesn't need image URLs.

    def now_playing(self) -> dict[str, Any] | None:
        data = self._call(self._sp.current_playback, additional_types="track,episode")
        if not data or not data.get("item"):
            return None
        item = data["item"]
        is_episode = item.get("type") == "episode"
        images = (item.get("images") if is_episode else (item.get("album") or {}).get("images")) or []
        return {
            "is_playing": bool(data.get("is_playing")),
            "name": item.get("name"),
            "subtitle": (item.get("show") or {}).get("name") if is_episode else ", ".join(_names(item.get("artists"))),
            "album": None if is_episode else (item.get("album") or {}).get("name"),
            "image_url": images[0]["url"] if images else None,
            "spotify_url": (item.get("external_urls") or {}).get("spotify"),
            "progress_ms": data.get("progress_ms") or 0,
            "duration_ms": item.get("duration_ms") or 0,
            "device": (data.get("device") or {}).get("name"),
        }

    def up_next(self, limit: int = 5) -> list[dict[str, Any]]:
        data = self._call(self._sp.queue) or {}
        return [
            {"name": t.get("name"), "subtitle": ", ".join(_names(t.get("artists"))) or (t.get("show") or {}).get("name"),
             "spotify_url": (t.get("external_urls") or {}).get("spotify")}
            for t in (data.get("queue") or [])[:limit]
            if t
        ]

    # --------------------------------------------------------------- internals

    def _with_device_fallback(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> str | None:
        """Run a playback command; if no device is active, retry on an idle one.

        Spotify only sends commands to an *active* device. If the user has Spotify
        open but idle, it counts as "available" rather than "active". In that case
        we target it explicitly instead of making the user tap play first.
        Returns the fallback device's name if one was used.
        """
        try:
            self._call(fn, *args, **kwargs)
            return None
        except ToolError as exc:
            if not _is_no_active_device(exc.__cause__):
                raise
        device = self._first_available_device()
        if device is None:
            raise ToolError(NO_DEVICE_MESSAGE) from None
        self._call(fn, *args, device_id=device["id"], **kwargs)
        return device.get("name")

    def _call(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """Run a spotipy call, translating failures into helpful ToolErrors."""
        try:
            return fn(*args, **kwargs)
        except spotipy.SpotifyException as exc:
            raise ToolError(_explain(exc)) from exc
        except SpotifyOauthError as exc:
            raise ToolError(
                f"Spotify login problem: {exc}. Delete the Spotify token cache file and restart Aurora to log in again."
            ) from exc
        except requests.RequestException as exc:
            logger.warning("Spotify network error: %s", exc)
            raise ToolError("Couldn't reach Spotify. Check the internet connection and try again.") from exc

    def _add_in_chunks(self, playlist_id: str, track_uris: list[str]) -> None:
        for start in range(0, len(track_uris), PLAYLIST_ADD_MAX):
            chunk = track_uris[start : start + PLAYLIST_ADD_MAX]
            try:
                self._call(self._sp.playlist_add_items, playlist_id, chunk)
            except ToolError as exc:
                cause = exc.__cause__
                if isinstance(cause, spotipy.SpotifyException) and cause.http_status == 403:
                    raise ToolError(
                        "Spotify refused to modify that playlist. You can only add to playlists you "
                        "own or collaborate on."
                    ) from cause
                raise

    def _current_user_id(self) -> str | None:
        if self._user_id is None:
            self._user_id = (self._call(self._sp.current_user) or {}).get("id")
        return self._user_id

    def _first_available_device(self) -> dict[str, Any] | None:
        devices = (self._call(self._sp.devices) or {}).get("devices") or []
        usable = [d for d in devices if d and d.get("id") and not d.get("is_restricted")]
        return usable[0] if usable else None

    def _remember(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for item in items:
            uri = item.get("uri")
            if uri:
                self._labels[uri] = _label(item)
        return items

    def _label_for(self, uri: str) -> str:
        if uri in self._labels:
            return self._labels[uri]
        kind, _, item_id = uri.removeprefix("spotify:").partition(":")
        lookup = {"track": (self._sp.track, shape_track), "album": (self._sp.album, shape_album),
                  "episode": (self._sp.episode, shape_episode)}.get(kind)
        if lookup is None:
            return uri
        fetch, shaper = lookup
        try:
            # One request per unknown item; GET /tracks?ids=... is gone for new apps.
            self._remember([shaper(self._call(fetch, item_id))])
        except ToolError:
            # Show something rather than blocking the preview. An unknown ID
            # here is a strong hint the model invented a URI, and the user will
            # see that before approving.
            self._labels[uri] = f"{uri} (couldn't look this up - may not exist)"
        return self._labels[uri]

    def _what(self, uris: list[str] | None, context_uri: str | None) -> str:
        if context_uri:
            return self._labels.get(context_uri, context_uri)
        if uris:
            first = self._labels.get(uris[0], uris[0])
            return first if len(uris) == 1 else f"{first} and {len(uris) - 1} more"
        return "resumed playback"


def _is_no_active_device(exc: BaseException | None) -> bool:
    return (
        isinstance(exc, spotipy.SpotifyException)
        and exc.http_status == 404
        and (exc.reason == "NO_ACTIVE_DEVICE" or "no active device" in str(exc.msg).lower())
    )


def _explain(exc: spotipy.SpotifyException) -> str:
    status, reason, msg = exc.http_status, exc.reason, str(exc.msg)
    if _is_no_active_device(exc):
        return NO_DEVICE_MESSAGE
    if status == 401:
        return "Spotify login expired or was revoked. Restart Aurora to log in to Spotify again."
    if status == 403 and (reason == "PREMIUM_REQUIRED" or "premium" in msg.lower()):
        return PREMIUM_MESSAGE
    if status == 403 and "restriction" in msg.lower():
        # e.g. pausing when already paused, or skipping inside content that
        # doesn't allow it.
        return "Spotify didn't allow that right now (for example, playback is already paused)."
    if status == 403:
        return (
            "Spotify refused the request (403). For a Development Mode app, check that this Spotify "
            "account is listed under User Management in the Spotify Developer Dashboard, and that "
            "the app owner has Spotify Premium."
        )
    if status == 429:
        return "Spotify's rate limit was hit. Wait a minute, then try again."
    if status == 404:
        return f"Spotify couldn't find that ({msg})."
    return f"Spotify API error {status}: {msg}"


# ------------------------------------------------------------------- shaping
# Pure functions: easy to unit test, and they work the same in every tool.

def _mmss(ms: int | None) -> str:
    if ms is None:
        return "?"
    seconds = int(ms) // 1000
    return f"{seconds // 60}:{seconds % 60:02d}"


def _names(people: list[dict] | None) -> list[str]:
    return [p.get("name") for p in (people or []) if p and p.get("name")]


def _label(item: dict[str, Any]) -> str:
    kind = item.get("type")
    if kind in ("track", "album") and item.get("artists"):
        return f"{item.get('name')} - {', '.join(item['artists'])}"
    if kind == "playlist":
        return f"playlist '{item.get('name')}'"
    if kind == "episode":
        return f"{item.get('name')} ({item.get('show')})"
    return str(item.get("name"))


def shape_track(track: dict[str, Any]) -> dict[str, Any]:
    album = track.get("album") or {}
    return {
        "type": "track",
        "name": track.get("name"),
        "artists": _names(track.get("artists")),
        "album": album.get("name"),
        "duration": _mmss(track.get("duration_ms")),
        "explicit": track.get("explicit"),
        "uri": track.get("uri"),
    }


def shape_episode(episode: dict[str, Any]) -> dict[str, Any]:
    show = episode.get("show") or {}
    return {
        "type": "episode",
        "name": episode.get("name"),
        "show": show.get("name"),
        "duration": _mmss(episode.get("duration_ms")),
        "uri": episode.get("uri"),
    }


def shape_artist(artist: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "artist",
        "name": artist.get("name"),
        # genres may be empty or missing; Spotify has been trimming artist fields.
        "genres": artist.get("genres") or [],
        "uri": artist.get("uri"),
    }


def shape_album(album: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "album",
        "name": album.get("name"),
        "artists": _names(album.get("artists")),
        "release_date": album.get("release_date"),
        "total_tracks": album.get("total_tracks"),
        "uri": album.get("uri"),
    }


def shape_playlist(playlist: dict[str, Any]) -> dict[str, Any]:
    owner = playlist.get("owner") or {}
    # Feb 2026: the playlist "tracks" field was renamed "items". Read either one.
    contents = playlist.get("items") or playlist.get("tracks") or {}
    return {
        "type": "playlist",
        "name": playlist.get("name"),
        "owner": owner.get("display_name") or owner.get("id"),
        "total_items": contents.get("total") if isinstance(contents, dict) else None,
        "uri": playlist.get("uri"),
    }
