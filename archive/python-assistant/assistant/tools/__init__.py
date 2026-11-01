"""Tool definitions the agent can call, plus the registry that wires them up."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from assistant.clients.spotify_client import SpotifyClient
from assistant.safety import Confirmer, deny_all
from assistant.tools.basic_tools import make_get_time_tool
from assistant.tools.registry import Tool, ToolError, ToolRegistry, ToolResult
from assistant.tools.spotify_tools import make_spotify_tools

__all__ = ["Tool", "ToolError", "ToolRegistry", "ToolResult", "build_registry"]


def build_registry(
    user_tz: ZoneInfo,
    spotify: SpotifyClient | None = None,
    *,
    confirmer: Confirmer = deny_all,
    playlist_confirm_threshold: int = 10,
) -> ToolRegistry:
    """Create the registry with every tool whose service is configured."""
    registry = ToolRegistry(confirmer=confirmer)
    registry.register(make_get_time_tool(user_tz))
    if spotify is not None:
        for tool in make_spotify_tools(spotify, confirm_threshold=playlist_confirm_threshold):
            registry.register(tool)
    return registry
