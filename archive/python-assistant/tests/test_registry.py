from __future__ import annotations

import json

import pytest
from pydantic import BaseModel, ConfigDict

from assistant.tools.registry import Tool, ToolError, ToolRegistry


class EchoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    times: int = 1


def make_registry(func) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(Tool(name="echo", description="Echo text.", input_model=EchoInput, func=func))
    return registry


def test_definition_uses_pydantic_schema():
    registry = make_registry(lambda a: a.text)
    (definition,) = registry.definitions()
    assert definition["name"] == "echo"
    assert definition["description"] == "Echo text."
    schema = definition["input_schema"]
    assert schema["type"] == "object"
    assert schema["required"] == ["text"]
    assert schema["additionalProperties"] is False
    assert "title" not in schema


def test_execute_success_serialises_dicts_to_json():
    registry = make_registry(lambda a: {"echo": a.text * a.times})
    result = registry.execute("echo", {"text": "hi", "times": 2})
    assert not result.is_error
    assert json.loads(result.content) == {"echo": "hihi"}


def test_execute_invalid_arguments_returns_error():
    registry = make_registry(lambda a: a.text)
    result = registry.execute("echo", {"times": "lots"})
    assert result.is_error
    assert "Invalid arguments for echo" in result.content


def test_execute_rejects_unexpected_arguments():
    registry = make_registry(lambda a: a.text)
    result = registry.execute("echo", {"text": "hi", "volume": 11})
    assert result.is_error


def test_unknown_tool_returns_error():
    registry = make_registry(lambda a: a.text)
    result = registry.execute("nope", {})
    assert result.is_error
    assert "Unknown tool" in result.content


def test_tool_error_message_is_passed_through():
    def fail(_):
        raise ToolError("No active Spotify device. Open Spotify on a device and try again.")

    result = make_registry(fail).execute("echo", {"text": "x"})
    assert result.is_error
    assert result.content.startswith("No active Spotify device")


def test_unexpected_exception_is_hidden_from_model():
    def crash(_):
        raise RuntimeError("secret internal detail")

    result = make_registry(crash).execute("echo", {"text": "x"})
    assert result.is_error
    assert "secret internal detail" not in result.content


def test_duplicate_registration_rejected():
    registry = make_registry(lambda a: a.text)
    with pytest.raises(ValueError):
        registry.register(Tool(name="echo", description="", input_model=EchoInput, func=lambda a: a))
