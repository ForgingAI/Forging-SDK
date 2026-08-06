"""Expose a ToolRegistry as an MCP (Model Context Protocol) server.

Any tool-group directory becomes an MCP server that Claude Code, Claude
Desktop, Cursor, or any MCP client can attach to::

    forging mcp --groups-root ./groups

Deferred groups surface through the standard ``load_tools`` meta-tool;
loading a group triggers a best-effort ``tools/list_changed`` notification
so clients refresh their tool list.

Requires the ``mcp`` extra: ``pip install "forging-sdk[mcp]"``.
"""

from __future__ import annotations

import contextlib
import json
from typing import Any

from .registry import LOAD_TOOLS_NAME, ToolRegistry

_INSTALL_HINT = 'MCP support requires the "mcp" extra: pip install "forging-sdk[mcp]"'

# MCP requires an object schema; registry tools may declare an empty one.
_EMPTY_SCHEMA: dict[str, Any] = {"type": "object", "properties": {}}


def tool_listing(registry: ToolRegistry) -> list[dict[str, Any]]:
    """Map the registry's OpenAI-style schemas to MCP tool dicts.

    Pure function so the mapping is testable without an MCP session.
    """
    listing: list[dict[str, Any]] = []
    for schema in registry.list_schemas():
        fn = schema["function"]
        listing.append(
            {
                "name": fn["name"],
                "description": fn["description"],
                "inputSchema": fn["parameters"] or _EMPTY_SCHEMA,
            }
        )
    return listing


async def dispatch(registry: ToolRegistry, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Execute one MCP tool call against the registry, returning a JSON payload.

    ``load_tools`` is synthesized by the registry in ``list_schemas`` but not
    executable through ``execute``, so it is special-cased here.
    """
    if name == LOAD_TOOLS_NAME:
        group = str(arguments.get("group", ""))
        added = registry.load_group(group)
        return {"loaded": group, "tools_added": added}
    result = await registry.execute(name, arguments or {})
    if result.is_error:
        return {"error": result.content.get("error", "tool execution failed")}
    return result.content


def build_mcp_server(registry: ToolRegistry, name: str = "forging-toolgroups"):
    """Build a low-level MCP ``Server`` wired to ``registry``."""
    try:
        import mcp.types as types
        from mcp.server.lowlevel import Server
    except ImportError as exc:  # pragma: no cover - exercised only without extra
        raise RuntimeError(_INSTALL_HINT) from exc

    server = Server(name)

    @server.list_tools()
    async def _list_tools() -> list[types.Tool]:
        return [types.Tool(**entry) for entry in tool_listing(registry)]

    @server.call_tool()
    async def _call_tool(tool_name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
        payload = await dispatch(registry, tool_name, arguments or {})
        if tool_name == LOAD_TOOLS_NAME:
            # Best-effort: tell the client the tool list changed.
            with contextlib.suppress(Exception):
                await server.request_context.session.send_tool_list_changed()
        return [types.TextContent(type="text", text=json.dumps(payload))]

    return server


async def serve_stdio(registry: ToolRegistry, name: str = "forging-toolgroups") -> None:
    """Run the MCP server over stdio until the client disconnects."""
    try:
        from mcp.server.stdio import stdio_server
    except ImportError as exc:  # pragma: no cover - exercised only without extra
        raise RuntimeError(_INSTALL_HINT) from exc

    server = build_mcp_server(registry, name)
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())
