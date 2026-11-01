"""Tool registry: maps tool names to Python functions and their JSON schemas.

Each tool declares its input as a pydantic model. That one model does two jobs:
  1. It generates the JSON schema we send to Claude, so the schema the model sees
     can never drift out of sync with the code that runs.
  2. It validates the arguments Claude sends back before our function runs. LLM
     output is untrusted input like any other, so we never pass it on unchecked.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel, ValidationError

from assistant.errors import ToolError
from assistant.safety import DECLINED_MESSAGE, Confirmer, PendingAction, deny_all

__all__ = ["Tool", "ToolError", "ToolRegistry", "ToolResult"]

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_model: type[BaseModel]
    func: Callable[[Any], Any]
    # Optional risk check: returns a preview if this particular call needs the
    # user's approval, or None if it can run straight away. See safety.py.
    confirmation: Callable[[Any], PendingAction | None] | None = None

    def definition(self) -> dict[str, Any]:
        """The tool definition in the shape the Anthropic Messages API expects."""
        schema = self.input_model.model_json_schema()
        # pydantic adds a top-level "title" that just repeats the class name;
        # dropping it keeps the prompt a little smaller.
        schema.pop("title", None)
        return {"name": self.name, "description": self.description, "input_schema": schema}


@dataclass(frozen=True)
class ToolResult:
    content: str
    is_error: bool = False
    declined: bool = False  # the user said no at the confirmation prompt


class ToolRegistry:
    def __init__(self, confirmer: Confirmer = deny_all) -> None:
        self._tools: dict[str, Tool] = {}
        self.confirmer = confirmer

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"Tool {tool.name!r} is already registered.")
        self._tools[tool.name] = tool

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def names(self) -> list[str]:
        return list(self._tools)

    def definitions(self) -> list[dict[str, Any]]:
        # Registration order is preserved, so the tool list is byte-identical on
        # every request. That keeps the request prefix stable for prompt caching.
        return [tool.definition() for tool in self._tools.values()]

    def execute(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        """Run a tool and always return a ToolResult, never raise.

        Every failure becomes an is_error result so the agent loop can hand it
        back to the model, which can then retry with fixed arguments, try a
        different tool, or explain the problem to the user.
        """
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(f"Unknown tool {name!r}. Available tools: {self.names()}", is_error=True)

        try:
            parsed = tool.input_model.model_validate(arguments)
        except ValidationError as exc:
            # One readable line per bad field ("timezone: ..."), so the model can
            # see exactly what to fix. include_input=False avoids echoing the
            # arguments back (later they may contain email text).
            problems = "; ".join(
                f"{'.'.join(str(p) for p in err['loc']) or 'input'}: {err['msg']}"
                for err in exc.errors(include_url=False, include_input=False)
            )
            return ToolResult(f"Invalid arguments for {name}: {problems}", is_error=True)

        try:
            # The gate runs after validation, so the preview reflects exactly the
            # arguments that will be used, and before the tool, so a "no" means
            # nothing happened.
            if tool.confirmation is not None:
                action = tool.confirmation(parsed)
                if action is not None and not self.confirmer(action):
                    return ToolResult(DECLINED_MESSAGE, declined=True)
            output = tool.func(parsed)
        except ToolError as exc:
            return ToolResult(str(exc), is_error=True)
        except Exception:
            # Unexpected bug: log the traceback for us, but give the model a
            # generic message rather than leaking internals into the conversation.
            logger.exception("Tool %s crashed", name)
            return ToolResult(f"Tool {name} failed with an internal error.", is_error=True)

        return ToolResult(_serialise(output))


def _serialise(output: Any) -> str:
    if isinstance(output, str):
        return output
    if isinstance(output, BaseModel):
        return output.model_dump_json()
    return json.dumps(output, default=str, ensure_ascii=False)
