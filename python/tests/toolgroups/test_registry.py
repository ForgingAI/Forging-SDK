import asyncio

import pytest

from forging_sdk.toolgroups import ToolCall, ToolDefinition, ToolRegistry


def _tool(name: str, read_only: bool = False, result: dict | None = None) -> ToolDefinition:
    async def handler(**kwargs):
        return result if result is not None else {"ok": name}

    return ToolDefinition(
        name=name,
        description=f"test tool {name}",
        input_schema={"type": "object", "properties": {}},
        handler=handler,
        read_only=read_only,
    )


def test_duplicate_registration_rejected() -> None:
    registry = ToolRegistry()
    registry.register(_tool("a"))
    with pytest.raises(ValueError, match="already registered"):
        registry.register(_tool("a"))


def test_load_tools_meta_tool_appears_only_while_groups_pending() -> None:
    registry = ToolRegistry()
    registry.register_deferred_group(
        "extras", "extra tools", lambda r: r.register(_tool("extra_one"))
    )

    names = [s["function"]["name"] for s in registry.list_schemas()]
    assert "load_tools" in names
    assert "extra_one" not in names

    added = registry.load_group("extras")
    assert added == ["extra_one"]

    names = [s["function"]["name"] for s in registry.list_schemas()]
    assert "load_tools" not in names
    assert "extra_one" in names


def test_load_group_is_idempotent_and_unknown_group_raises() -> None:
    registry = ToolRegistry()
    registry.register_deferred_group("g", "d", lambda r: r.register(_tool("t1")))
    assert registry.load_group("g") == ["t1"]
    assert registry.load_group("g") == []
    with pytest.raises(ValueError, match="Unknown tool group"):
        registry.load_group("nope")


def test_execute_auto_loads_group_on_direct_tool_call() -> None:
    registry = ToolRegistry()
    registry.register_deferred_group(
        "g",
        "d",
        lambda r: r.register(_tool("hidden", result={"found": True})),
        tool_names=["hidden"],
    )
    result = asyncio.run(registry.execute("hidden", {}))
    assert result.content == {"found": True}
    assert not result.is_error


def test_execute_unknown_tool_returns_error_result() -> None:
    registry = ToolRegistry()
    result = asyncio.run(registry.execute("ghost", {}))
    assert result.is_error
    assert "Unknown tool" in result.content["error"]


def test_handler_exception_becomes_error_result() -> None:
    async def boom(**kwargs):
        raise RuntimeError("kaput")

    registry = ToolRegistry()
    registry.register(ToolDefinition(name="b", description="d", input_schema={}, handler=boom))
    result = asyncio.run(registry.execute("b", {}))
    assert result.is_error
    assert "kaput" in result.content["error"]


def test_execute_batch_lanes() -> None:
    order: list[str] = []

    def make(name: str, read_only: bool) -> ToolDefinition:
        async def handler(**kwargs):
            order.append(name)
            return {"ran": name}

        return ToolDefinition(
            name=name, description="d", input_schema={}, handler=handler, read_only=read_only
        )

    registry = ToolRegistry(externally_routed=frozenset({"spawn"}))
    registry.register(make("r1", read_only=True))
    registry.register(make("w1", read_only=False))
    registry.register(make("w2", read_only=False))

    calls = [
        ToolCall(id="1", name="w1", arguments={}),
        ToolCall(id="2", name="r1", arguments={}),
        ToolCall(id="3", name="spawn", arguments={}),
        ToolCall(id="4", name="w2", arguments={}),
    ]
    results = asyncio.run(registry.execute_batch(calls))

    by_id = {r.tool_call_id: r for r in results}
    assert by_id["3"].is_error and "externally routed" in by_id["3"].content["error"]
    assert not by_id["1"].is_error and not by_id["2"].is_error and not by_id["4"].is_error
    # Write lane preserves call order.
    assert [n for n in order if n.startswith("w")] == ["w1", "w2"]


def test_externally_routed_wins_over_read_only_flag() -> None:
    registry = ToolRegistry(externally_routed=frozenset({"spawn"}))
    registry.register(_tool("spawn", read_only=True))
    results = asyncio.run(registry.execute_batch([ToolCall(id="1", name="spawn", arguments={})]))
    assert results[0].is_error
