"""``forging mcp`` — serve a tool-group directory over the Model Context Protocol."""

from __future__ import annotations

import asyncio
import pathlib
import sys
from typing import Annotated

import typer

_GROUPS_ROOT_OPT = typer.Option(
    "--groups-root",
    help="Directory containing <group>/toolgroup.toml capability bundles.",
    exists=True,
    file_okay=False,
)
_NAME_OPT = typer.Option("--name", help="MCP server name.")
_EAGER_OPT = typer.Option(
    "--eager",
    help="Load every group at startup instead of exposing the load_tools meta-tool.",
)
_ENABLE_OPT = typer.Option(
    "--enable",
    help="Serve only these groups (repeatable). Default: all discovered groups.",
)
_DISABLE_OPT = typer.Option(
    "--disable",
    help="Never serve these groups (repeatable). Applied after --enable.",
)
_STATS_OPT = typer.Option(
    "--stats",
    help="Print the eager-vs-deferred tool-surface measurement for the selection and exit.",
)


def mcp(
    groups_root: Annotated[pathlib.Path, _GROUPS_ROOT_OPT],
    name: Annotated[str, _NAME_OPT] = "forging-toolgroups",
    eager: Annotated[bool, _EAGER_OPT] = False,
    enable: Annotated[list[str] | None, _ENABLE_OPT] = None,
    disable: Annotated[list[str] | None, _DISABLE_OPT] = None,
    stats: Annotated[bool, _STATS_OPT] = False,
) -> None:
    """Serve tool groups as an MCP stdio server for Claude Code, Cursor, etc."""
    from forging_sdk.toolgroups import ToolRegistry, register_groups

    # Group modules commonly live inside the groups root itself; make them
    # importable without requiring an installed package.
    sys.path.insert(0, str(groups_root.resolve()))

    include = frozenset(enable) if enable else None
    exclude = frozenset(disable) if disable else frozenset()

    if stats:
        from forging_sdk.toolgroups.stats import render_stats, surface_stats

        report = surface_stats(groups_root, include=include, exclude=exclude)
        typer.echo(render_stats(report, groups_root))
        return

    from forging_sdk.toolgroups.mcp import serve_stdio

    registry = ToolRegistry()
    manifests = register_groups(registry, groups_root, include=include, exclude=exclude)
    if eager:
        for manifest in manifests:
            registry.load_group(manifest.name)
    asyncio.run(serve_stdio(registry, name=name))
