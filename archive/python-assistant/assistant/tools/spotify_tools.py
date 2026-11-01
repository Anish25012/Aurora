"""Spotify tools the model can call: schemas, descriptions, and thin handlers.

The tool descriptions are effectively part of the prompt: they're how the model
decides *when* to use each tool. So they say what each tool is for, and include
the limits that would otherwise cause bad guesses (e.g. the 10-result search cap).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from assistant.clients.spotify_client import PLAYLIST_ADD_MAX, SEARCH_MAX_LIMIT, SpotifyClient
from assistant.safety import PendingAction
from assistant.tools.registry import Tool

# Validating URI shapes up front catches malformed or invented IDs before they
# reach Spotify, and gives the model an error message it can fix.
_ID = r"[A-Za-z0-9]{22}"
TrackUri = Annotated[str, StringConstraints(pattern=rf"^spotify:track:{_ID}$")]
PlaylistItemUri = Annotated[str, StringConstraints(pattern=rf"^spotify:(track|episode):{_ID}$")]
ContextUri = Annotated[str, StringConstraints(pattern=rf"^spotify:(album|artist|playlist):{_ID}$")]
LibraryUri = Annotated[str, StringConstraints(pattern=rf"^spotify:(track|album):{_ID}$")]


class _Strict(BaseModel):
    # extra="forbid" -> additionalProperties: false. Besides catching typos, this
    # is what stops anyone from smuggling in a "confirmed": true argument.
    model_config = ConfigDict(extra="forbid")


class _NoArgs(_Strict):
    pass


class SearchInput(_Strict):
    query: str = Field(
        min_length=1,
        description=(
            "Search text. Supports Spotify field filters, e.g. 'artist:Radiohead', "
            "'album:OK Computer', 'genre:lo-fi', 'year:2020-2024'."
        ),
    )
    types: list[Literal["track", "artist", "album", "playlist"]] = Field(
        default=["track"], min_length=1, description="What kinds of items to search for."
    )
    limit: int = Field(default=5, ge=1, le=SEARCH_MAX_LIMIT, description="Results per type (max 10).")


class TopItemsInput(_Strict):
    kind: Literal["tracks", "artists"] = Field(description="Whether to get top tracks or top artists.")
    time_range: Literal["short_term", "medium_term", "long_term"] = Field(
        default="medium_term",
        description="short_term = roughly the last 4 weeks, medium_term = ~6 months, long_term = ~1 year.",
    )
    limit: int = Field(default=20, ge=1, le=50)


class RecentlyPlayedInput(_Strict):
    limit: int = Field(default=20, ge=1, le=50, description="How many recent plays to return (max 50).")


class MyPlaylistsInput(_Strict):
    limit: int = Field(default=50, ge=1, le=50)


class PlayInput(_Strict):
    uris: list[TrackUri] | None = Field(
        default=None, max_length=100, description="Specific track URIs to play, in order."
    )
    context_uri: ContextUri | None = Field(
        default=None, description="An album, artist or playlist URI to play."
    )

    @model_validator(mode="after")
    def _not_both(self) -> PlayInput:
        if self.uris and self.context_uri:
            raise ValueError("give either uris or context_uri, not both")
        return self


class QueueInput(_Strict):
    uri: PlaylistItemUri = Field(description="Track or episode URI to queue.")


class CreatePlaylistInput(_Strict):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    track_uris: list[PlaylistItemUri] = Field(min_length=1, max_length=PLAYLIST_ADD_MAX)
    public: bool = Field(default=False, description="Private unless the user asks for public.")


class AddToPlaylistInput(_Strict):
    playlist: str = Field(description="Playlist URI (spotify:playlist:...) or ID, from get_my_playlists.")
    track_uris: list[PlaylistItemUri] = Field(min_length=1, max_length=PLAYLIST_ADD_MAX)

    @field_validator("playlist")
    @classmethod
    def _to_id(cls, value: str) -> str:
        playlist_id = value.removeprefix("spotify:playlist:")
        if len(playlist_id) != 22 or not playlist_id.isalnum():
            raise ValueError("must be a Spotify playlist URI or 22-character ID")
        return playlist_id


class SaveToLibraryInput(_Strict):
    uris: list[LibraryUri] = Field(min_length=1, max_length=40, description="Track or album URIs to save.")


def make_spotify_tools(client: SpotifyClient, confirm_threshold: int = 10) -> list[Tool]:
    """Build the Spotify tools.

    confirm_threshold: playlist changes involving more than this many tracks need
    the user's approval. Small edits ("add this song to Focus") run straight
    away; bulk changes (a 20-song playlist) show a preview first.
    """

    def confirm_create(a: CreatePlaylistInput) -> PendingAction | None:
        if len(a.track_uris) <= confirm_threshold:
            return None
        visibility = "public" if a.public else "private"
        return PendingAction(
            tool="create_playlist",
            summary=f"Create a {visibility} playlist '{a.name}' with {len(a.track_uris)} tracks",
            details=client.describe_uris(a.track_uris),
        )

    def confirm_add(a: AddToPlaylistInput) -> PendingAction | None:
        if len(a.track_uris) <= confirm_threshold:
            return None
        return PendingAction(
            tool="add_to_playlist",
            summary=f"Add {len(a.track_uris)} tracks to {client.playlist_name(a.playlist)}",
            details=client.describe_uris(a.track_uris),
        )

    return [
        # ---- read ----
        Tool(
            name="get_current_playback",
            description=(
                "Get what's playing on the user's Spotify right now: the track or episode, "
                "artists, progress, the device, and shuffle/repeat state. Returns "
                "is_playing=false if nothing is active."
            ),
            input_model=_NoArgs,
            func=lambda _: client.current_playback(),
        ),
        Tool(
            name="search",
            description=(
                "Search the Spotify catalogue for tracks, artists, albums or playlists. Returns "
                "names and Spotify URIs, which other tools use to play or save items. At most 10 "
                "results per type, so make queries specific. Run several searches to gather more."
            ),
            input_model=SearchInput,
            func=lambda a: client.search(a.query, list(a.types), a.limit),
        ),
        Tool(
            name="get_top_items",
            description=(
                "Get the user's most-listened tracks or artists over a time range. Use this "
                "to understand their taste, e.g. before suggesting or building playlists."
            ),
            input_model=TopItemsInput,
            func=lambda a: client.top_items(a.kind, a.time_range, a.limit),
        ),
        Tool(
            name="get_recently_played",
            description="Get the tracks the user played most recently, newest first, with timestamps (UTC).",
            input_model=RecentlyPlayedInput,
            func=lambda a: client.recently_played(a.limit),
        ),
        Tool(
            name="get_my_playlists",
            description=(
                "List the user's own and followed playlists with their URIs. Use it to find a "
                "playlist by name (e.g. 'Focus') before adding to it. Only playlists with "
                "owned_by_you=true can be modified."
            ),
            input_model=MyPlaylistsInput,
            func=lambda a: client.my_playlists(a.limit),
        ),
        # ---- playback (Spotify Premium + an active device) ----
        Tool(
            name="play",
            description=(
                "Start or resume playback on the user's Spotify, immediately. With no arguments, "
                "resumes. For 'play <song>', search for it and play the best match straight away. "
                "Don't ask first unless the match is genuinely ambiguous. "
                "Pass track URIs to play specific songs, or an album/artist/playlist URI as "
                "context_uri. Get URIs from search, get_top_items, etc. Never make them up. "
                "To play something by mood ('something chill'), search for a fitting playlist "
                "or tracks first."
            ),
            input_model=PlayInput,
            func=lambda a: client.play(a.uris, a.context_uri),
        ),
        Tool(
            name="add_to_queue",
            description=(
                "Add one track or episode to the user's Spotify queue, so it plays after the "
                "current song. Use for 'queue X', 'play X next' or 'add X to the queue'. For "
                "'play X' (start it now), use play instead."
            ),
            input_model=QueueInput,
            func=lambda a: client.add_to_queue(a.uri),
        ),
        Tool(name="pause", description="Pause the user's Spotify playback.",
             input_model=_NoArgs, func=lambda _: client.pause()),
        Tool(name="skip_next", description="Skip to the next track on the user's Spotify.",
             input_model=_NoArgs, func=lambda _: client.skip_next()),
        Tool(name="skip_previous", description="Go back to the previous track on the user's Spotify.",
             input_model=_NoArgs, func=lambda _: client.skip_previous()),
        # ---- write ----
        Tool(
            name="create_playlist",
            description=(
                "Create a new playlist in the user's account and fill it with the given track "
                "URIs (max 100). Private by default. To build one from the user's taste, gather "
                "tracks with get_top_items, get_recently_played and search first. Large "
                "playlists show the user a preview for approval before anything is created."
            ),
            input_model=CreatePlaylistInput,
            func=lambda a: client.create_playlist(a.name, a.description, list(a.track_uris), a.public),
            confirmation=confirm_create,
        ),
        Tool(
            name="add_to_playlist",
            description=(
                "Add tracks (by URI) to the end of one of the user's existing playlists. Find the "
                "playlist with get_my_playlists first. For 'this song', use get_current_playback "
                "to get the URI."
            ),
            input_model=AddToPlaylistInput,
            func=lambda a: client.add_to_playlist(a.playlist, list(a.track_uris)),
            confirmation=confirm_add,
        ),
        Tool(
            name="save_to_library",
            description="Save tracks or albums (by URI) to the user's Spotify library ('Liked Songs' / saved albums).",
            input_model=SaveToLibraryInput,
            func=lambda a: client.save_to_library(list(a.uris)),
        ),
    ]
