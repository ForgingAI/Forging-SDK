import asyncio

import pytest

from forging_sdk.toolgroups import ToolDefinition, ToolRegistry
from forging_sdk.toolgroups.mcp import dispatch, tool_listing

pytest.importorskip("mcp", reason="mcp extra not installed")


def _tool(name: str, schema: dict | None = None) -> ToolDefinition:
    async def handler(**kwargs):
        return {"ran": name, "args": kwargs}

    return ToolDefinition(
        name=name,
        description=f"tool {name}",
        input_schema=schema if schema is not None else {},
        handler=handler,
    )


def test_listing_maps_schemas_and_defaults_empty_schema() -> None:
    registry = ToolRegistry()
    registry.register(_tool("plain"))
    registry.register(_tool("typed", {"type": "object", "properties": {"x": {"type": "string"}}}))

    listing = {t["name"]: t for t in tool_listing(registry)}
    assert listing["plain"]["inputSchema"] == {"type": "object", "properties": {}}
    assert listing["typed"]["inputSchema"]["properties"]["x"] == {"type": "string"}


def test_listing_includes_load_tools_while_groups_pending() -> None:
    registry = ToolRegistry()
    registry.register_deferred_group("extras", "extra tools", lambda r: r.register(_tool("late")))
    names = {t["name"] for t in tool_listing(registry)}
    assert "load_tools" in names


def test_dispatch_executes_tool() -> None:
    registry = ToolRegistry()
    registry.register(_tool("echo"))
    payload = asyncio.run(dispatch(registry, "echo", {"msg": "hi"}))
    assert payload == {"ran": "echo", "args": {"msg": "hi"}}


def test_dispatch_load_tools_loads_group() -> None:
    registry = ToolRegistry()
    registry.register_deferred_group("extras", "extra tools", lambda r: r.register(_tool("late")))
    payload = asyncio.run(dispatch(registry, "load_tools", {"group": "extras"}))
    assert payload == {"loaded": "extras", "tools_added": ["late"]}
    assert "late" in registry.tool_names


def test_dispatch_unknown_tool_returns_error_payload() -> None:
    registry = ToolRegistry()
    payload = asyncio.run(dispatch(registry, "ghost", {}))
    assert "error" in payload


def test_build_mcp_server_constructs() -> None:
    from forging_sdk.toolgroups.mcp import build_mcp_server

    registry = ToolRegistry()
    registry.register(_tool("t"))
    server = build_mcp_server(registry, name="test-server")
    assert server.name == "test-server"
