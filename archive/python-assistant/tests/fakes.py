"""Test doubles: a scripted fake LLM and builders for SDK-shaped responses.

The fake mimics the shape of Anthropic SDK responses (objects with .type,
.content, .stop_reason, .usage) closely enough for the agent loop, without any
network calls. Each test scripts exactly what the "model" says on each turn.
"""

from __future__ import annotations

import copy
from types import SimpleNamespace
from typing import Any


def text_block(text: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=text)


def tool_use_block(name: str, tool_input: dict[str, Any], block_id: str = "toolu_1") -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", id=block_id, name=name, input=tool_input)


def response(*blocks: SimpleNamespace, stop_reason: str | None = None) -> SimpleNamespace:
    if stop_reason is None:
        stop_reason = "tool_use" if any(b.type == "tool_use" for b in blocks) else "end_turn"
    return SimpleNamespace(
        content=list(blocks),
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=100, output_tokens=20),
    )


class FakeLLM:
    """Returns scripted responses in order and records every request it receives."""

    def __init__(self, *responses: SimpleNamespace) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def create(self, *, system, messages, tools, tool_choice=None):
        # Deep-copy so later mutations of agent.history don't rewrite what we saw.
        self.calls.append(
            {"system": system, "messages": copy.deepcopy(messages), "tools": tools, "tool_choice": tool_choice}
        )
        if not self._responses:
            raise AssertionError("FakeLLM ran out of scripted responses")
        return self._responses.pop(0)
