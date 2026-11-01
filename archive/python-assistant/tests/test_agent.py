from __future__ import annotations

from zoneinfo import ZoneInfo

import pytest

from assistant.agent import REFUSAL_MESSAGE, Agent
from assistant.tools.basic_tools import make_get_time_tool
from assistant.tools.registry import ToolRegistry
from tests.fakes import FakeLLM, response, text_block, tool_use_block


@pytest.fixture
def registry(clock) -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(make_get_time_tool(ZoneInfo("Europe/London"), clock=clock))
    return reg


def make_agent(llm, registry, clock, max_iters=10) -> Agent:
    return Agent(llm, registry, timezone="Europe/London", max_tool_iterations=max_iters, clock=clock)


def test_plain_answer_without_tools(registry, clock):
    llm = FakeLLM(response(text_block("Hello!")))
    reply = make_agent(llm, registry, clock).run("hi")

    assert reply.text == "Hello!"
    assert reply.stop_reason == "end_turn"
    assert reply.tool_calls == []
    assert reply.model_calls == 1


def test_tool_call_round_trip(registry, clock):
    llm = FakeLLM(
        response(tool_use_block("get_time", {"timezone": "Asia/Tokyo"}, "toolu_abc")),
        response(text_block("It's 22:30 in Tokyo.")),
    )
    agent = make_agent(llm, registry, clock)
    reply = agent.run("What time is it in Tokyo?")

    assert reply.text == "It's 22:30 in Tokyo."
    assert [c.name for c in reply.tool_calls] == ["get_time"]
    assert reply.usage.input_tokens == 200 and reply.usage.output_tokens == 40

    # The second request must carry the tool result, linked by tool_use_id.
    second_messages = llm.calls[1]["messages"]
    tool_result = second_messages[-1]["content"][0]
    assert tool_result["type"] == "tool_result"
    assert tool_result["tool_use_id"] == "toolu_abc"
    assert tool_result["is_error"] is False
    assert "22:30:00+09:00" in tool_result["content"]

    # History: user, assistant(tool_use), user(tool_result), assistant(text)
    assert [m["role"] for m in agent.history] == ["user", "assistant", "user", "assistant"]


def test_parallel_tool_calls_return_in_one_message(registry, clock):
    llm = FakeLLM(
        response(
            tool_use_block("get_time", {"timezone": "Asia/Tokyo"}, "toolu_1"),
            tool_use_block("get_time", {"timezone": "America/New_York"}, "toolu_2"),
        ),
        response(text_block("Done.")),
    )
    make_agent(llm, registry, clock).run("Time in Tokyo and New York?")

    results = llm.calls[1]["messages"][-1]["content"]
    assert [r["tool_use_id"] for r in results] == ["toolu_1", "toolu_2"]


def test_tool_error_is_returned_to_model_with_is_error(registry, clock):
    llm = FakeLLM(
        response(tool_use_block("get_time", {"timezone": "Not/AZone"})),
        response(text_block("That timezone doesn't exist.")),
    )
    reply = make_agent(llm, registry, clock).run("Time in Not/AZone?")

    tool_result = llm.calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is True
    assert reply.tool_calls[0].is_error is True
    assert reply.text == "That timezone doesn't exist."


def test_iteration_cap_forces_a_final_text_answer(registry, clock):
    # A model that would call tools forever.
    looping = response(tool_use_block("get_time", {}))
    final = response(text_block("Stopping here."))
    llm = FakeLLM(*([looping] * 3), final)
    reply = make_agent(llm, registry, clock, max_iters=3).run("loop please")

    assert len(reply.tool_calls) == 3
    assert reply.model_calls == 4
    assert reply.stop_reason == "iteration_limit"
    assert reply.text == "Stopping here."
    # Only the final call disables tools.
    assert [c["tool_choice"] for c in llm.calls] == [None, None, None, {"type": "none"}]


def test_history_persists_across_turns(registry, clock):
    llm = FakeLLM(response(text_block("Nice to meet you, Sam.")), response(text_block("You're Sam.")))
    agent = make_agent(llm, registry, clock)
    agent.run("I'm Sam.")
    agent.run("What's my name?")

    second_request = llm.calls[1]["messages"]
    assert [m["role"] for m in second_request] == ["user", "assistant", "user"]
    assert second_request[0]["content"] == "I'm Sam."


def test_reset_clears_history(registry, clock):
    agent = make_agent(FakeLLM(response(text_block("ok"))), registry, clock)
    agent.run("hi")
    agent.reset()
    assert agent.history == []


def test_refusal_rolls_back_the_turn(registry, clock):
    llm = FakeLLM(response(text_block("first")), response(stop_reason="refusal"))
    agent = make_agent(llm, registry, clock)
    agent.run("hello")
    history_before = list(agent.history)

    reply = agent.run("something declined")

    assert reply.stop_reason == "refusal"
    assert reply.text == REFUSAL_MESSAGE
    assert agent.history == history_before


def test_api_exception_rolls_back_the_turn(registry, clock):
    class ExplodingLLM:
        def create(self, **_):
            raise ConnectionError("network down")

    agent = make_agent(ExplodingLLM(), registry, clock)
    with pytest.raises(ConnectionError):
        agent.run("hi")
    assert agent.history == []


def test_system_prompt_has_date_timezone_and_clarify_rule(registry, clock):
    llm = FakeLLM(response(text_block("ok")))
    make_agent(llm, registry, clock).run("hi")

    system = llm.calls[0]["system"]
    assert "Wednesday 21 October 2026" in system
    assert "Europe/London" in system
    assert "clarifying question" in system


def test_tool_definitions_are_sent(registry, clock):
    llm = FakeLLM(response(text_block("ok")))
    make_agent(llm, registry, clock).run("hi")
    assert [t["name"] for t in llm.calls[0]["tools"]] == ["get_time"]
