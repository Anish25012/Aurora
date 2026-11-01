"""The confirmation gate: risky tool calls only run after an explicit user "yes"."""

from __future__ import annotations

import json
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

import pytest
from pydantic import BaseModel, ConfigDict

from assistant.agent import Agent
from assistant.safety import DECLINED_MESSAGE, PendingAction, approve_all, deny_all
from assistant.tools.registry import Tool, ToolRegistry
from tests.fakes import FakeLLM, response, text_block, tool_use_block


class BulkInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    count: int


def make_registry(confirmer, func=None):
    func = func or MagicMock(return_value={"done": True})
    registry = ToolRegistry(confirmer=confirmer)
    registry.register(
        Tool(
            name="bulk_change",
            description="Change many things.",
            input_model=BulkInput,
            func=func,
            # Risky only above 10 items, like the playlist rule.
            confirmation=lambda a: PendingAction("bulk_change", f"Change {a.count} things") if a.count > 10 else None,
        )
    )
    return registry, func


def test_default_registry_denies_risky_actions():
    # Fail closed: a front end that never wires up a confirmer can't run risky tools.
    registry = ToolRegistry()
    func = MagicMock()
    registry.register(Tool("x", "d", BulkInput, func, confirmation=lambda a: PendingAction("x", "risky")))
    result = registry.execute("x", {"count": 1})
    assert result.declined
    func.assert_not_called()


def test_declined_action_does_not_run():
    registry, func = make_registry(deny_all)
    result = registry.execute("bulk_change", {"count": 20})

    func.assert_not_called()
    assert result.declined and not result.is_error
    assert result.content == DECLINED_MESSAGE


def test_approved_action_runs():
    registry, func = make_registry(approve_all)
    result = registry.execute("bulk_change", {"count": 20})
    func.assert_called_once()
    assert json.loads(result.content) == {"done": True}


def test_low_risk_call_skips_the_prompt():
    confirmer = MagicMock(return_value=False)
    registry, func = make_registry(confirmer)
    registry.execute("bulk_change", {"count": 3})
    confirmer.assert_not_called()
    func.assert_called_once()


def test_confirmer_sees_the_exact_validated_action():
    seen: list[PendingAction] = []
    registry, _ = make_registry(lambda action: seen.append(action) or False)
    registry.execute("bulk_change", {"count": 42})
    assert seen == [PendingAction("bulk_change", "Change 42 things")]


@pytest.mark.parametrize("smuggled", [{"confirmed": True}, {"skip_confirmation": True}, {"approved": "yes"}])
def test_model_cannot_pre_approve_via_arguments(smuggled):
    confirmer = MagicMock(return_value=False)
    registry, func = make_registry(confirmer)
    result = registry.execute("bulk_change", {"count": 20, **smuggled})

    assert result.is_error  # unknown argument rejected by validation
    func.assert_not_called()


def test_agent_reports_decline_to_model_and_records_it(clock):
    registry, func = make_registry(deny_all)
    llm = FakeLLM(
        response(tool_use_block("bulk_change", {"count": 50}, "toolu_risky")),
        response(text_block("No problem, I've left everything as it was.")),
    )
    agent = Agent(llm, registry, timezone="Europe/London", clock=clock)
    reply = agent.run("change 50 things")

    func.assert_not_called()
    assert reply.tool_calls[0].declined is True
    tool_result = llm.calls[1]["messages"][-1]["content"][0]
    assert tool_result["tool_use_id"] == "toolu_risky"
    assert tool_result["content"] == DECLINED_MESSAGE


def test_system_prompt_tells_model_to_respect_declines(clock):
    llm = FakeLLM(response(text_block("ok")))
    registry = ToolRegistry()
    Agent(llm, registry, clock=clock).run("hi")
    assert "declines" in llm.calls[0]["system"]
