"""Demo tool group: an in-memory notepad.

Serve it over MCP from the repo root:

    pip install "forging-sdk[mcp]"
    forging mcp --groups-root examples/toolgroups
"""

from __future__ import annotations

from forging_sdk.toolgroups import ToolDefinition

_NOTES: list[str] = []


async def _save_note(text: str) -> dict:
    _NOTES.append(text)
    return {"saved": True, "count": len(_NOTES)}


async def _list_notes() -> dict:
    return {"notes": list(_NOTES)}


def register(registry, config=None) -> None:
    registry.register(
        ToolDefinition(
            name="save_note",
            description="Save a note to the in-memory notepad.",
            input_schema={
                "type": "object",
                "required": ["text"],
                "properties": {"text": {"type": "string", "description": "The note to save"}},
            },
            handler=_save_note,
        )
    )
    registry.register(
        ToolDefinition(
            name="list_notes",
            description="List every note saved so far.",
            input_schema={"type": "object", "properties": {}},
            handler=_list_notes,
            read_only=True,
        )
    )
