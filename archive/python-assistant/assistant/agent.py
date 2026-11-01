"""The agent loop: let Claude decide which tools to call, run them, repeat.

One user request goes through this cycle:

    user message -> model -> tool_use blocks? --yes--> run tools -> tool_result blocks -> model -> ...
                                  |
                                  no --> final text answer

We write this loop by hand (rather than using the SDK's beta tool runner) because
we need to own every step: capping iterations, recording each tool call for
logging, and, in later phases, pausing for user confirmation before risky tools.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from assistant.llm import LLM
from assistant.tools.basic_tools import system_clock
from assistant.tools.registry import ToolRegistry

logger = logging.getLogger(__name__)

REFUSAL_MESSAGE = (
    "Sorry, I can't help with that request. Try rephrasing it, or ask me something else."
)


def build_system_prompt(today: datetime, timezone: str) -> str:
    # Only the date goes in the system prompt, not the time. The prompt then stays
    # byte-identical for a whole day, which keeps the request prefix cacheable.
    # When the model needs the exact time, it calls get_time.
    return f"""You are Aurora, a personal assistant that helps the user with everyday tasks \
using the tools available to you.

Context:
- Today is {today.strftime("%A %d %B %Y")}.
- The user's timezone is {timezone}. Interpret relative times ("today", "this morning", \
"Friday") in that timezone.

How to work:
- Use tools to get real data. Never invent results a tool could have told you.
- You may call several tools, in sequence, to complete a multi-step request.
- If a request is ambiguous and a wrong guess would matter (which playlist, which \
email, which person), ask one short clarifying question instead of guessing.
- Some actions pause for the user's approval. If the user declines, accept that and \
don't try to get around it with other tools.
- If a tool returns an error, read it. Retry with corrected arguments if that would help; \
otherwise explain the problem to the user plainly and suggest what they can do.
- Answer in plain, concise English. Don't mention tool names or internal details unless asked."""


@dataclass
class ToolCallRecord:
    name: str
    arguments: dict[str, Any]
    is_error: bool
    latency_ms: float
    declined: bool = False


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    def add(self, usage: Any) -> None:
        if usage is None:
            return
        self.input_tokens += getattr(usage, "input_tokens", 0) or 0
        self.output_tokens += getattr(usage, "output_tokens", 0) or 0


@dataclass
class AgentReply:
    text: str
    # end_turn | iteration_limit | refusal | max_tokens
    stop_reason: str
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    model_calls: int = 0
    latency_ms: float = 0.0


class Agent:
    def __init__(
        self,
        llm: LLM,
        registry: ToolRegistry,
        *,
        timezone: str = "Europe/London",
        max_tool_iterations: int = 10,
        clock: Callable[[ZoneInfo], datetime] = system_clock,
    ) -> None:
        self._llm = llm
        self._registry = registry
        self._timezone = timezone
        self._max_tool_iterations = max_tool_iterations
        self._clock = clock
        # The full conversation for this session. The Messages API is stateless,
        # so we resend the whole history each turn; that's what makes follow-ups
        # like "send that draft" or "add the second one" work.
        self.history: list[dict[str, Any]] = []

    def reset(self) -> None:
        self.history.clear()

    def run(self, user_message: str) -> AgentReply:
        started = time.perf_counter()
        # Remember where this turn started so we can roll the whole turn back if it
        # fails. A half-finished turn (e.g. a tool_use with no matching tool_result)
        # would make every later request in the session invalid.
        checkpoint = len(self.history)
        self.history.append({"role": "user", "content": user_message})
        try:
            reply = self._loop(checkpoint)
        except Exception:
            del self.history[checkpoint:]
            raise
        reply.latency_ms = (time.perf_counter() - started) * 1000
        return reply

    def _loop(self, checkpoint: int) -> AgentReply:
        system = build_system_prompt(self._clock(ZoneInfo(self._timezone)), self._timezone)
        tools = self._registry.definitions()
        records: list[ToolCallRecord] = []
        usage = Usage()
        tool_rounds = 0
        model_calls = 0

        while True:
            # Runaway-loop guard: once the tool budget is spent, make one last call
            # with tool_choice "none" so the model must answer in text with what it
            # has, instead of the user getting nothing back.
            at_limit = tool_rounds >= self._max_tool_iterations
            response = self._llm.create(
                system=system,
                messages=self.history,
                tools=tools,
                tool_choice={"type": "none"} if at_limit else None,
            )
            model_calls += 1
            usage.add(getattr(response, "usage", None))

            if response.stop_reason == "refusal":
                # A declined request produces no usable assistant turn, so drop the
                # user's message too and leave the history as it was before.
                del self.history[checkpoint:]
                return AgentReply(REFUSAL_MESSAGE, "refusal", records, usage, model_calls)

            # Append the model's content exactly as returned (including any thinking
            # blocks). Editing or stripping earlier turns breaks follow-up requests.
            self.history.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "tool_use" and not at_limit:
                tool_results = self._run_tools(response.content, records)
                # All results go back in ONE user message, even when the model asked
                # for several tools in parallel. That's what the API expects.
                self.history.append({"role": "user", "content": tool_results})
                tool_rounds += 1
                continue

            text = _final_text(response.content)
            if at_limit:
                stop_reason = "iteration_limit"
                logger.warning("Hit the tool iteration limit (%d)", self._max_tool_iterations)
            elif response.stop_reason == "max_tokens":
                stop_reason = "max_tokens"
                text += "\n\n(My answer was cut off because it got too long.)"
            else:
                stop_reason = "end_turn"
            return AgentReply(text, stop_reason, records, usage, model_calls)

    def _run_tools(self, content: list[Any], records: list[ToolCallRecord]) -> list[dict[str, Any]]:
        results = []
        for block in content:
            if getattr(block, "type", None) != "tool_use":
                continue
            arguments = dict(block.input or {})
            started = time.perf_counter()
            result = self._registry.execute(block.name, arguments)
            records.append(
                ToolCallRecord(
                    name=block.name,
                    arguments=arguments,
                    is_error=result.is_error,
                    # Includes time spent waiting at a confirmation prompt.
                    latency_ms=(time.perf_counter() - started) * 1000,
                    declined=result.declined,
                )
            )
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,  # must match the tool_use block it answers
                    "content": result.content,
                    # is_error tells the model the call failed, so it can recover
                    # or explain, rather than treating the error text as data.
                    "is_error": result.is_error,
                }
            )
        return results


def _final_text(content: list[Any]) -> str:
    parts = [block.text for block in content if getattr(block, "type", None) == "text"]
    text = "\n".join(p for p in parts if p).strip()
    return text or "(No response.)"
