"""``forging dev`` — local development server for plugin testing."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

console = Console()


def dev(
    directory: str = typer.Argument(
        ".",
        help="Plugin directory (must contain forging-plugin.toml)",
    ),
    port: int = typer.Option(
        8001,
        "--port",
        "-p",
        help="Port to run the dev server on",
    ),
    reload: bool = typer.Option(
        True,
        "--reload/--no-reload",
        help="Auto-reload on file changes",
    ),
    host: str = typer.Option(
        "127.0.0.1",
        "--host",
        help="Interface to bind. Use 0.0.0.0 to expose on your network (e.g. testing from another device).",
    ),
) -> None:
    """Start a local development server that loads your plugin.

    The dev server:
      - Reads ``forging-plugin.toml`` from the plugin directory
      - Creates an in-memory database with Forging schema
      - Registers the plugin's content types and tools
      - Exposes the same API endpoints as the full backend
      - Hot-reloads on file changes (default)

    Access the API at ``http://localhost:{port}/api/plugins`` to verify
    your plugin is loaded.
    """
    target = Path(directory).resolve()
    manifest_path = target / "forging-plugin.toml"

    if not manifest_path.exists():
        console.print(f"[red]forging-plugin.toml not found in {target}[/red]")
        raise typer.Exit(1)

    console.print("\n[bold]Starting Forging dev server[/bold]")
    console.print(f"  Plugin: {target}")
    console.print(f"  Port: {port}")
    console.print(f"  Reload: {reload}")
    console.print()

    try:
        import uvicorn

        uvicorn.run(
            "forging_sdk.cli.dev_server:create_dev_app",
            factory=True,
            host=host,
            port=port,
            reload=reload,
            reload_dirs=[str(target)] if reload else None,
        )
    except ImportError as exc:
        console.print(
            "[red]uvicorn is required for the dev server. Install it: pip install uvicorn[/red]"
        )
        raise typer.Exit(1) from exc
