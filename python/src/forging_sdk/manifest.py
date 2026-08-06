"""Plugin manifest parser and validator.

Reads ``forging-plugin.toml`` from disk and validates against the
:class:`PluginManifest` schema.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Manifest models (standalone copies — no backend dependency)
# ---------------------------------------------------------------------------


class ContentTypeEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    type_key: str
    pipeline_id: str
    token_cost: int = 5
    max_generation_time_s: int = 60
    artifact_kinds: list[str] = Field(default_factory=list)
    description: str = ""


class BuilderToolEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    module: str
    register_function: str = "register"


class FrontendEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    entry: str
    content_types: list[str] = Field(default_factory=list)


class HookEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    events: list[str] = Field(default_factory=list)
    handler: str


class PluginManifest(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    version: str
    description: str = ""
    author: str = ""
    license: str = "MIT"
    min_forging_version: str = "0.2.0"

    content_types: dict[str, ContentTypeEntry] = Field(default_factory=dict)
    builder_tools: BuilderToolEntry | None = None
    frontend: FrontendEntry | None = None
    hooks: HookEntry | None = None
    dependencies: dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

MANIFEST_FILENAME = "forging-plugin.toml"


def parse_manifest(path: Path | None = None) -> PluginManifest:
    """Parse and validate a plugin manifest.

    Parameters
    ----------
    path:
        Path to the TOML file.  Defaults to ``forging-plugin.toml`` in
        the current working directory.

    Returns
    -------
    PluginManifest
        Validated manifest.

    Raises
    ------
    FileNotFoundError
        If the manifest file does not exist.
    pydantic.ValidationError
        If the manifest does not conform to the schema.
    """
    if path is None:
        path = Path.cwd() / MANIFEST_FILENAME

    if not path.exists():
        msg = f"Manifest not found: {path}"
        raise FileNotFoundError(msg)

    raw = path.read_text(encoding="utf-8")
    data = tomllib.loads(raw)
    plugin_section = data.get("plugin", data)
    return PluginManifest.model_validate(plugin_section)


def validate_manifest(path: Path | None = None) -> list[str]:
    """Validate a manifest and return a list of warnings.

    Returns an empty list if everything is valid.  Raises on hard
    errors (missing file, schema violations).
    """
    manifest = parse_manifest(path)
    warnings: list[str] = []

    if not manifest.description:
        warnings.append("Missing description — add one for marketplace visibility")

    if not manifest.author:
        warnings.append("Missing author field")

    if not manifest.content_types and manifest.builder_tools is None:
        warnings.append("Plugin declares no content types or builder tools")

    # Check for reserved type keys
    reserved = {"image", "video", "text", "carousel", "interaction"}
    for type_key in manifest.content_types:
        if type_key in reserved:
            warnings.append(f"Content type '{type_key}' conflicts with a built-in type")

    return warnings
