"""Main CLI entrypoint for the Forging SDK.

Extends the base Forging CLI with plugin development commands:
  - ``forging init``      — interactive plugin scaffolding
  - ``forging scaffold``  — quick generator
  - ``forging test``      — validate and test a plugin
  - ``forging dev``       — local development server
  - ``forging publish``   — package and upload a plugin
  - ``forging mcp``       — serve a tool-group directory over MCP (stdio)
"""

from __future__ import annotations

import typer

from forging_sdk.cli.dev_cmd import dev
from forging_sdk.cli.init_cmd import init_plugin
from forging_sdk.cli.mcp_cmd import mcp
from forging_sdk.cli.publish_cmd import publish
from forging_sdk.cli.scaffold_cmd import scaffold
from forging_sdk.cli.test_cmd import test_plugin

app = typer.Typer(
    name="forging",
    help="Forging SDK — build and publish plugins for the Forging platform.",
    no_args_is_help=True,
)

# Plugin development commands
app.command("init")(init_plugin)
app.command("scaffold")(scaffold)
app.command("test")(test_plugin)
app.command("dev")(dev)
app.command("publish")(publish)
app.command("mcp")(mcp)


if __name__ == "__main__":
    app()
