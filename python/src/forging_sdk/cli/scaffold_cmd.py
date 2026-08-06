"""``forging scaffold`` — quick plugin generator without interactive prompts."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from forging_sdk.cli.init_cmd import (
    _generate_manifest,
    _scaffold_builder_tool,
    _scaffold_content_type,
    _scaffold_module,
)

console = Console()


def scaffold(
    plugin_type: str = typer.Argument(
        ...,
        help="Plugin type: content-type, builder-tool, or module",
    ),
    name: str = typer.Argument(
        ...,
        help="Plugin name (used for directory and manifest)",
    ),
    directory: str = typer.Option(
        None,
        "--dir",
        "-d",
        help="Parent directory (default: current directory)",
    ),
) -> None:
    """Quickly generate a plugin skeleton without interactive prompts.

    Example::

        forging scaffold content-type panoramic-image
        forging scaffold builder-tool screenshot
        forging scaffold module crm-dashboard
    """
    valid_types = ("content-type", "builder-tool", "module")
    if plugin_type not in valid_types:
        console.print(f"[red]Invalid type: {plugin_type}[/red]")
        console.print(f"Valid types: {', '.join(valid_types)}")
        raise typer.Exit(1)

    parent = Path(directory) if directory else Path.cwd()
    target = (parent / name).resolve()

    if target.exists():
        console.print(f"[yellow]Directory {target} already exists[/yellow]")
        raise typer.Exit(1)

    target.mkdir(parents=True)

    # Write manifest
    manifest = _generate_manifest(name, "", "", plugin_type)
    (target / "forging-plugin.toml").write_text(manifest, encoding="utf-8")

    # Write type-specific files
    if plugin_type == "content-type":
        _scaffold_content_type(target, name)
    elif plugin_type == "builder-tool":
        _scaffold_builder_tool(target, name)
    elif plugin_type == "module":
        _scaffold_module(target, name)

    console.print(f"[green]Scaffolded {plugin_type} plugin: {target}[/green]")
