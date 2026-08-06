"""Builder tool helpers for plugin authors.

Provides a decorator for defining builder tools with less boilerplate.

Example::

    from forging_sdk.builder_tool import builder_tool

    @builder_tool(
        name="take_screenshot",
        description="Capture a screenshot of a URL",
        input_schema={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to capture"},
            },
            "required": ["url"],
        },
        read_only=True,
    )
    async def take_screenshot(url: str) -> dict:
        return {"screenshot": "base64..."}
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolDefinition:
    """A single tool the builder agent can call.

    Mirrors ``Forging-Builder/agent/tool_registry.ToolDefinition``
    so that plugin authors can develop without importing the builder
    directly.
    """

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[..., Coroutine[Any, Any, dict[str, Any]]]
    read_only: bool = False


# Internal registry for decorator-based tools
_REGISTERED: list[ToolDefinition] = []


def builder_tool(
    *,
    name: str,
    description: str,
    input_schema: dict[str, Any],
    read_only: bool = False,
) -> Callable[..., Any]:
    """Decorator that registers an async function as a builder tool."""

    def decorator(
        fn: Callable[..., Coroutine[Any, Any, dict[str, Any]]],
    ) -> Callable[..., Coroutine[Any, Any, dict[str, Any]]]:
        tool = ToolDefinition(
            name=name,
            description=description,
            input_schema=input_schema,
            handler=fn,
            read_only=read_only,
        )
        _REGISTERED.append(tool)
        return fn

    return decorator


def get_registered_tools() -> list[ToolDefinition]:
    """Return all tools registered via the ``@builder_tool`` decorator."""
    return list(_REGISTERED)


def register_all(registry: Any, _config: Any) -> None:
    """Register all decorator-defined tools with the given registry.

    This function can be referenced from ``forging-plugin.toml``::

        [plugin.builder_tools]
        module = "my_plugin"
        register_function = "register_all"
    """
    for tool in _REGISTERED:
        registry.register(tool)
