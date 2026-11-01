from __future__ import annotations

import json
from zoneinfo import ZoneInfo

from assistant.tools.basic_tools import make_get_time_tool
from assistant.tools.registry import ToolRegistry


def registry_with_time(clock) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(make_get_time_tool(ZoneInfo("Europe/London"), clock=clock))
    return registry


def test_get_time_defaults_to_user_timezone(clock):
    result = registry_with_time(clock).execute("get_time", {})
    data = json.loads(result.content)
    assert not result.is_error
    assert data["timezone"] == "Europe/London"
    assert data["iso"] == "2026-10-21T14:30:00+01:00"  # BST in October
    assert data["human"] == "Wednesday 21 October 2026, 14:30"


def test_get_time_other_timezone(clock):
    result = registry_with_time(clock).execute("get_time", {"timezone": "Asia/Tokyo"})
    data = json.loads(result.content)
    assert data["timezone"] == "Asia/Tokyo"
    assert data["iso"] == "2026-10-21T22:30:00+09:00"


def test_get_time_invalid_timezone_is_an_error(clock):
    result = registry_with_time(clock).execute("get_time", {"timezone": "Mars/Olympus_Mons"})
    assert result.is_error
    assert "not a valid IANA timezone" in result.content
