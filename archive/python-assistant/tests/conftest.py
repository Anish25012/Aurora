from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

# A frozen "now" so time-dependent tests are deterministic.
FIXED_NOW = datetime(2026, 10, 21, 14, 30, tzinfo=ZoneInfo("Europe/London"))


def fixed_clock(tz: ZoneInfo) -> datetime:
    return FIXED_NOW.astimezone(tz)


@pytest.fixture
def clock():
    return fixed_clock
