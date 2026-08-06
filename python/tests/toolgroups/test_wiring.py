import pathlib
import sys
import textwrap

import pytest

from forging_sdk.toolgroups import ToolRegistry, register_groups, resolve_entry


@pytest.fixture()
def demo_pkg(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> pathlib.Path:
    """A real importable package with two groups, child inheriting parent."""
    pkg = tmp_path / "demo_groups_pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "impl.py").write_text(
        textwrap.dedent(
            """
            from forging_sdk.toolgroups import ToolDefinition

            def _tool(name):
                async def handler(**kwargs):
                    return {"ran": name}
                return ToolDefinition(
                    name=name, description=name, input_schema={}, handler=handler)

            def register_base(registry, config):
                registry.register(_tool("base_tool"))

            def register_child(registry, config):
                registry.register(_tool("child_tool"))
            """
        )
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    sys.modules.pop("demo_groups_pkg", None)
    sys.modules.pop("demo_groups_pkg.impl", None)

    groups = tmp_path / "groups"
    groups.mkdir()
    (groups / "base").mkdir()
    (groups / "base" / "toolgroup.toml").write_text(
        textwrap.dedent(
            """
            name = "base"
            version = "1.0"
            intents = ["base things"]
            top_level_entry = "demo_groups_pkg.impl:register_base"
            subagent_entry = "demo_groups_pkg.impl:register_base"
            """
        )
    )
    (groups / "child").mkdir()
    (groups / "child" / "toolgroup.toml").write_text(
        textwrap.dedent(
            """
            name = "child"
            version = "1.0"
            intents = ["child things"]
            inherits = "base"
            tools = ["child_tool"]
            top_level_entry = "demo_groups_pkg.impl:register_child"
            subagent_entry = "demo_groups_pkg.impl:register_child"
            """
        )
    )
    return groups


def test_resolve_entry_rejects_malformed() -> None:
    with pytest.raises(ValueError, match="expected 'module.path:attr'"):
        resolve_entry("no_colon_here")


def test_register_groups_defers_until_loaded(demo_pkg: pathlib.Path) -> None:
    registry = ToolRegistry()
    manifests = register_groups(registry, demo_pkg)
    assert [m.name for m in manifests] == ["base", "child"]
    assert registry.tool_names == []  # nothing imported or registered yet
    assert set(registry.pending_groups) == {"base", "child"}


def test_loading_child_registers_parent_tools_first(demo_pkg: pathlib.Path) -> None:
    registry = ToolRegistry()
    register_groups(registry, demo_pkg)
    added = registry.load_group("child")
    assert added == ["base_tool", "child_tool"]


def test_manifest_tools_list_enables_autoload(demo_pkg: pathlib.Path) -> None:
    import asyncio

    registry = ToolRegistry()
    register_groups(registry, demo_pkg)
    result = asyncio.run(registry.execute("child_tool", {}))
    assert result.content == {"ran": "child_tool"}
