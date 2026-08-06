"""``forging test`` — validate and test a Forging plugin."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from forging_sdk.manifest import parse_manifest, validate_manifest

console = Console()


def test_plugin(
    directory: str = typer.Argument(
        ".",
        help="Plugin directory (must contain forging-plugin.toml)",
    ),
    run_tests: bool = typer.Option(
        True,
        "--tests/--no-tests",
        help="Run pytest after validation",
    ),
) -> None:
    """Validate a plugin manifest and optionally run its test suite.

    Steps:
      1. Parse and validate ``forging-plugin.toml``
      2. Check for common issues (missing fields, reserved names)
      3. Run pytest if ``--tests`` (default)
    """
    target = Path(directory).resolve()
    manifest_path = target / "forging-plugin.toml"

    # Step 1: Parse
    console.print(f"\n[bold]Validating plugin at {target}[/bold]\n")

    try:
        manifest = parse_manifest(manifest_path)
        console.print(
            f"  [green]\u2713[/green] Manifest parsed: {manifest.name} v{manifest.version}"
        )
    except FileNotFoundError as exc:
        console.print(f"  [red]\u2717[/red] forging-plugin.toml not found in {target}")
        raise typer.Exit(1) from exc
    except Exception as exc:
        console.print(f"  [red]\u2717[/red] Manifest validation failed: {exc}")
        raise typer.Exit(1) from exc

    # Step 2: Warnings
    try:
        warnings = validate_manifest(manifest_path)
        if warnings:
            for w in warnings:
                console.print(f"  [yellow]\u26a0[/yellow] {w}")
        else:
            console.print("  [green]\u2713[/green] No warnings")
    except Exception as exc:
        console.print(f"  [red]\u2717[/red] Validation error: {exc}")
        raise typer.Exit(1) from exc

    # Step 3: Content type checks
    if manifest.content_types:
        console.print(f"\n  Content types: {', '.join(manifest.content_types.keys())}")
        for key, ct in manifest.content_types.items():
            console.print(f"    {key}: pipeline={ct.pipeline_id}, cost={ct.token_cost}")

    if manifest.builder_tools:
        console.print(f"\n  Builder tools: {manifest.builder_tools.module}")

    if manifest.hooks:
        console.print(f"\n  Hooks: {', '.join(manifest.hooks.events)}")

    # Step 4: Run tests
    if run_tests:
        console.print("\n[bold]Running tests...[/bold]\n")
        import subprocess

        result = subprocess.run(
            ["python", "-m", "pytest", str(target), "-v", "--tb=short"],
            cwd=str(target),
        )

        if result.returncode != 0:
            console.print("\n  [red]\u2717[/red] Tests failed")
            raise typer.Exit(result.returncode)

        console.print("\n  [green]\u2713[/green] Tests passed")

    console.print("\n[green]Plugin validation complete[/green]\n")
