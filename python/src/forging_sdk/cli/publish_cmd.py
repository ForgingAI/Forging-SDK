"""``forging publish`` — package and upload a plugin to the Forging registry."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

import typer
from rich.console import Console

from forging_sdk.manifest import parse_manifest

console = Console()

# Files/directories to exclude from the package
EXCLUDE_PATTERNS = {
    "__pycache__",
    ".git",
    ".env",
    "node_modules",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "build",
    "*.egg-info",
}


def publish(
    directory: str = typer.Argument(
        ".",
        help="Plugin directory (must contain forging-plugin.toml)",
    ),
    api_url: str = typer.Option(
        None,
        "--api-url",
        envvar="FORGING_API_URL",
        help="Forging API URL (default: from config or env)",
    ),
    token: str = typer.Option(
        None,
        "--token",
        envvar="FORGING_AUTH_TOKEN",
        help="Auth token (default: from config or env)",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Package but don't upload",
    ),
) -> None:
    """Package a plugin and publish it to the Forging plugin registry.

    Steps:
      1. Validate the manifest
      2. Package the plugin directory as a tarball
      3. Upload to the Forging API
      4. Report the published plugin URL
    """
    target = Path(directory).resolve()
    manifest_path = target / "forging-plugin.toml"

    # Step 1: Validate
    console.print(f"\n[bold]Publishing plugin from {target}[/bold]\n")

    try:
        manifest = parse_manifest(manifest_path)
        console.print(f"  [green]\u2713[/green] {manifest.name} v{manifest.version}")
    except FileNotFoundError as exc:
        console.print(f"  [red]\u2717[/red] forging-plugin.toml not found in {target}")
        raise typer.Exit(1) from exc
    except Exception as exc:
        console.print(f"  [red]\u2717[/red] Manifest validation failed: {exc}")
        raise typer.Exit(1) from exc

    if not manifest.description:
        console.print(
            "  [yellow]\u26a0[/yellow] Missing description — add one for marketplace visibility"
        )
    if not manifest.author:
        console.print("  [yellow]\u26a0[/yellow] Missing author field")

    # Step 2: Package
    console.print("\n  Packaging...")
    package_bytes = _create_package(target, manifest.name)
    size_kb = len(package_bytes) / 1024
    console.print(f"  [green]\u2713[/green] Package created: {size_kb:.1f} KB")

    if dry_run:
        output_path = target / f"{manifest.name}-{manifest.version}.tar.gz"
        output_path.write_bytes(package_bytes)
        console.print(f"\n  [green]Dry run — package saved to {output_path}[/green]")
        return

    # Step 3: Upload
    if not api_url:
        api_url = _resolve_api_url()
    if not token:
        token = _resolve_token()

    if not api_url or not token:
        console.print(
            "\n  [red]\u2717[/red] API URL and auth token required. "
            "Set FORGING_API_URL and FORGING_AUTH_TOKEN, or run `forging login` first."
        )
        raise typer.Exit(1)

    console.print(f"\n  Uploading to {api_url}...")

    try:
        import httpx

        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{api_url}/api/admin/plugins/upload",
                files={"package": (f"{manifest.name}.tar.gz", package_bytes, "application/gzip")},
                headers={"Authorization": f"Bearer {token}"},
            )

            if response.status_code == 200:
                result = response.json()
                console.print(
                    f"  [green]\u2713[/green] Published: {result.get('name', manifest.name)}"
                )
                plugin_url = f"{api_url}/api/plugins/{manifest.name}"
                console.print(f"\n  Plugin URL: {plugin_url}")
            else:
                console.print(
                    f"  [red]\u2717[/red] Upload failed: {response.status_code} — {response.text}"
                )
                raise typer.Exit(1)

    except httpx.ConnectError as exc:
        console.print(f"  [red]\u2717[/red] Cannot connect to {api_url}")
        raise typer.Exit(1) from exc

    console.print("\n[green]Done![/green]\n")


def _create_package(plugin_dir: Path, name: str) -> bytes:
    """Create a gzipped tarball of the plugin directory."""
    buf = io.BytesIO()

    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in sorted(plugin_dir.rglob("*")):
            rel = path.relative_to(plugin_dir)

            # Skip excluded patterns
            if any(part in EXCLUDE_PATTERNS for part in rel.parts):
                continue
            if any(path.match(pat) for pat in EXCLUDE_PATTERNS if "*" in pat):
                continue

            tar.add(path, arcname=str(rel))

    return buf.getvalue()


def _resolve_api_url() -> str | None:
    """Try to resolve the API URL from config files."""
    try:
        config_path = Path.home() / ".forging" / "config.toml"
        if config_path.exists():
            import tomllib

            data = tomllib.loads(config_path.read_text())
            return data.get("api_url")
    except Exception:
        pass
    return None


def _resolve_token() -> str | None:
    """Try to resolve the auth token from config files."""
    try:
        config_path = Path.home() / ".forging" / "config.toml"
        if config_path.exists():
            import tomllib

            data = tomllib.loads(config_path.read_text())
            return data.get("auth_token")
    except Exception:
        pass
    return None
