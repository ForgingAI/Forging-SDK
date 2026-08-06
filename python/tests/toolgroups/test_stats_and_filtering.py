import pathlib
import sys
import textwrap

import pytest

from forging_sdk.toolgroups import (
    ToolRegistry,
    discover_tool_groups,
    register_groups,
    select_manifests,
    surface_stats,
)


@pytest.fixture()
def demo_root(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> pathlib.Path:
    pkg = tmp_path / "filter_demo_pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text(
        textwrap.dedent(
            """
            from forging_sdk.toolgroups import ToolDefinition

            def _tool(name):
                async def handler(**kwargs):
                    return {"ran": name}
                return ToolDefinition(
                    name=name,
                    description=f"a tool named {name} with a reasonably long description",
                    input_schema={
                        "type": "object",
                        "properties": {"arg": {"type": "string", "description": "an argument"}},
                    },
                    handler=handler,
                )

            def register_alpha(registry, config):
                registry.register(_tool("alpha_one"))
                registry.register(_tool("alpha_two"))

            def register_beta(registry, config):
                registry.register(_tool("beta_one"))
            """
        )
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    sys.modules.pop("filter_demo_pkg", None)

    groups = tmp_path / "groups"
    groups.mkdir()
    for name in ("alpha", "beta"):
        d = groups / name
        d.mkdir()
        (d / "toolgroup.toml").write_text(
            textwrap.dedent(
                f"""
                name = "{name}"
                version = "1.0"
                intents = ["{name} things"]
                top_level_entry = "filter_demo_pkg:register_{name}"
                subagent_entry = "filter_demo_pkg:register_{name}"
                """
            )
        )
    return groups


def test_select_manifests_allowlist_then_denylist(demo_root: pathlib.Path) -> None:
    manifests = discover_tool_groups(demo_root)
    assert [m.name for m in select_manifests(manifests, include=frozenset({"alpha"}))] == ["alpha"]
    assert [m.name for m in select_manifests(manifests, exclude=frozenset({"alpha"}))] == ["beta"]
    assert select_manifests(manifests, frozenset({"alpha"}), frozenset({"alpha"})) == []


def test_select_manifests_rejects_unknown_names(demo_root: pathlib.Path) -> None:
    manifests = discover_tool_groups(demo_root)
    with pytest.raises(ValueError, match="unknown group"):
        select_manifests(manifests, include=frozenset({"ghost"}))


def test_register_groups_honors_filters(demo_root: pathlib.Path) -> None:
    registry = ToolRegistry()
    register_groups(registry, demo_root, exclude=frozenset({"beta"}))
    assert set(registry.pending_groups) == {"alpha"}


def test_surface_stats_deferred_smaller_than_eager(demo_root: pathlib.Path) -> None:
    stats = surface_stats(demo_root)
    assert stats.group_names == ("alpha", "beta")
    assert stats.eager.tool_count == 3
    assert stats.deferred.tool_count == 1  # just load_tools
    assert stats.deferred.schema_bytes < stats.eager.schema_bytes
    assert 0 < stats.reduction_pct < 100
    assert stats.eager.est_tokens == stats.eager.schema_bytes // 4


def test_surface_stats_respects_filters(demo_root: pathlib.Path) -> None:
    stats = surface_stats(demo_root, include=frozenset({"beta"}))
    assert stats.group_names == ("beta",)
    assert stats.eager.tool_count == 1
