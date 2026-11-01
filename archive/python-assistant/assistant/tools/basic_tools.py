"""General-purpose tools that don't depend on any external API."""

from __future__ import annotations

from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from assistant.tools.registry import Tool

Clock = Callable[[ZoneInfo], datetime]


def system_clock(tz: ZoneInfo) -> datetime:
    return datetime.now(tz)


class GetTimeInput(BaseModel):
    # extra="forbid" sets additionalProperties: false in the schema, so the model
    # is told exactly which arguments exist and typos are rejected, not ignored.
    model_config = ConfigDict(extra="forbid")

    timezone: str | None = Field(
        default=None,
        description=(
            "IANA timezone name, e.g. 'Asia/Tokyo' or 'America/New_York'. "
            "Omit to use the user's own timezone."
        ),
    )

    @field_validator("timezone")
    @classmethod
    def _must_be_iana(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"{value!r} is not a valid IANA timezone name") from None
        return value


def make_get_time_tool(default_tz: ZoneInfo, clock: Clock = system_clock) -> Tool:
    """Build the get_time tool.

    The clock is injected so tests can freeze time instead of patching datetime.
    """

    def get_time(args: GetTimeInput) -> dict[str, str]:
        tz = ZoneInfo(args.timezone) if args.timezone else default_tz
        now = clock(tz)
        return {
            "timezone": str(tz),
            "iso": now.isoformat(timespec="seconds"),
            "human": now.strftime("%A %d %B %Y, %H:%M"),
            "utc_offset": now.strftime("%z"),
        }

    return Tool(
        name="get_time",
        description=(
            "Get the current date and time. Use this when the user asks what time or day "
            "it is, either for themselves or in another timezone/city."
        ),
        input_model=GetTimeInput,
        func=get_time,
    )
