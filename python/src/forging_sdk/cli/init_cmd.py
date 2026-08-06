"""``forging init`` — interactive plugin scaffolding wizard."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console
from rich.prompt import Confirm, Prompt

console = Console()


def init_plugin(
    directory: str = typer.Argument(
        ".",
        help="Directory to create the plugin in (default: current directory)",
    ),
) -> None:
    """Create a new Forging plugin with interactive prompts."""
    target = Path(directory).resolve()

    console.print("\n[bold]Forging Plugin Wizard[/bold]\n")

    # Gather info
    name = Prompt.ask("Plugin name", default=target.name)
    description = Prompt.ask("Description", default="")
    author = Prompt.ask("Author", default="")

    plugin_type = Prompt.ask(
        "Plugin type",
        choices=["content-type", "builder-tool", "module"],
        default="content-type",
    )

    # Create directory
    target.mkdir(parents=True, exist_ok=True)

    # Write manifest
    manifest_path = target / "forging-plugin.toml"
    if manifest_path.exists() and not Confirm.ask(
        f"[yellow]{manifest_path} already exists. Overwrite?[/yellow]"
    ):
        raise typer.Exit(0)

    manifest_content = _generate_manifest(name, description, author, plugin_type)
    manifest_path.write_text(manifest_content, encoding="utf-8")

    # Write type-specific files
    if plugin_type == "content-type":
        _scaffold_content_type(target, name)
    elif plugin_type == "builder-tool":
        _scaffold_builder_tool(target, name)
    elif plugin_type == "module":
        _scaffold_module(target, name)

    console.print(f"\n[green]Plugin created at {target}[/green]")
    console.print("\nNext steps:")
    console.print(f"  cd {target}")
    console.print("  forging test    # validate the manifest")
    console.print("  forging dev     # start local dev server")


def _generate_manifest(name: str, description: str, author: str, plugin_type: str) -> str:
    """Generate a forging-plugin.toml manifest."""
    lines = [
        "[plugin]",
        f'name = "{name}"',
        'version = "0.1.0"',
        f'description = "{description}"',
        f'author = "{author}"',
        'license = "MIT"',
        'min_forging_version = "0.2.0"',
    ]

    if plugin_type == "content-type":
        type_key = name.replace("-", "_").replace(" ", "_")
        lines.extend(
            [
                "",
                f"[plugin.content_types.{type_key}]",
                f'pipeline_id = "{type_key}-gen-v1"',
                "token_cost = 5",
                "max_generation_time_s = 60",
                'artifact_kinds = ["inline_base64"]',
                f'description = "{description or name}"',
            ]
        )
    elif plugin_type == "builder-tool":
        module_name = name.replace("-", "_").replace(" ", "_")
        lines.extend(
            [
                "",
                "[plugin.builder_tools]",
                f'module = "{module_name}"',
                'register_function = "register"',
            ]
        )
    elif plugin_type == "module":
        lines.extend(
            [
                "",
                "# Modules are typically created via the Forging UI.",
                "# This manifest registers lifecycle hooks for the module.",
                "[plugin.hooks]",
                'events = ["module.installed"]',
                f'handler = "{name.replace("-", "_")}.hooks:on_event"',
            ]
        )

    return "\n".join(lines) + "\n"


def _scaffold_content_type(target: Path, name: str) -> None:
    """Create starter files for a content type plugin."""
    src_dir = target / "src"
    src_dir.mkdir(exist_ok=True)

    type_key = name.replace("-", "_").replace(" ", "_")

    init_py = target / f"{type_key}.py"
    if not init_py.exists():
        init_py.write_text(
            f'"""Content type plugin: {name}."""\n\nfrom __future__ import annotations\n',
            encoding="utf-8",
        )

    renderer = src_dir / "renderer.tsx"
    if not renderer.exists():
        renderer.write_text(
            f"// Frontend renderer for {name}\n"
            "// This file is bundled and served via the plugin frontend API.\n\n"
            "import type { RendererProps } from '@/registry/types'\n\n"
            f"export function {type_key.title().replace('_', '')}Renderer"
            "({ post }: RendererProps) {\n"
            "  return (\n"
            "    <div>\n"
            "      <p>{post.caption}</p>\n"
            "    </div>\n"
            "  )\n"
            "}\n",
            encoding="utf-8",
        )


def _scaffold_builder_tool(target: Path, name: str) -> None:
    """Create starter files for a builder tool plugin."""
    module_name = name.replace("-", "_").replace(" ", "_")

    tool_py = target / f"{module_name}.py"
    if not tool_py.exists():
        tool_py.write_text(
            f'"""Builder tool plugin: {name}."""\n\n'
            "from __future__ import annotations\n\n"
            "from typing import TYPE_CHECKING\n\n"
            "if TYPE_CHECKING:\n"
            "    from agent.config import BuilderConfig\n"
            "    from agent.tool_registry import ToolDefinition, ToolRegistry\n\n\n"
            f"async def {module_name}_action(input_text: str) -> dict:\n"
            f'    """Implement your tool logic here."""\n'
            f'    return {{"result": f"Processed: {{input_text}}"}}\n\n\n'
            "def register(registry: ToolRegistry, config: BuilderConfig) -> None:\n"
            f'    """Register {name} tools."""\n'
            "    from agent.tool_registry import ToolDefinition\n\n"
            "    registry.register(\n"
            "        ToolDefinition(\n"
            f'            name="{module_name}",\n'
            f'            description="{name} tool",\n'
            "            input_schema={\n"
            '                "type": "object",\n'
            '                "properties": {\n'
            '                    "input_text": {\n'
            '                        "type": "string",\n'
            '                        "description": "Input text to process",\n'
            "                    },\n"
            "                },\n"
            '                "required": ["input_text"],\n'
            "            },\n"
            f"            handler={module_name}_action,\n"
            "            read_only=True,\n"
            "        )\n"
            "    )\n",
            encoding="utf-8",
        )


def _scaffold_module(target: Path, name: str) -> None:
    """Create starter files for a module plugin."""
    module_name = name.replace("-", "_").replace(" ", "_")

    hooks_py = target / f"{module_name}" / "hooks.py"
    hooks_py.parent.mkdir(parents=True, exist_ok=True)

    if not hooks_py.exists():
        hooks_py.write_text(
            f'"""Lifecycle hooks for {name} module."""\n\n'
            "from __future__ import annotations\n\n"
            "from typing import Any\n\n\n"
            "async def on_event(event_name: str, payload: dict[str, Any]) -> None:\n"
            f'    """Handle lifecycle events for {name}."""\n'
            '    if event_name == "module.installed":\n'
            "        # Run setup logic when the module is installed\n"
            "        pass\n",
            encoding="utf-8",
        )

    init_py = target / f"{module_name}" / "__init__.py"
    if not init_py.exists():
        init_py.write_text(
            f'"""Module plugin: {name}."""\n\nfrom __future__ import annotations\n',
            encoding="utf-8",
        )
