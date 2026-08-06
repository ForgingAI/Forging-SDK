"""Tool-group manifest discovery + validation.

A tool group is a self-contained capability bundle. Each group lives at
``<root>/<name>/`` and declares its public surface in a ``toolgroup.toml``
manifest::

    name = "website"
    version = "1.0"
    intents = ["build a site", "landing page"]
    top_level_entry = "my_pkg.groups.website:register_top_level"
    subagent_entry = "my_pkg.groups.website:register_as_subagent"
    # optional:
    inherits = "base"
    tools = ["scaffold", "deploy"]   # enables auto-load on direct call

``discover_tool_groups`` globs all manifests under a root directory,
validates the required fields, enforces single-level inheritance, rejects
duplicate group names and overlapping intent strings, and returns a list
of immutable ``ToolGroupManifest`` instances sorted by name.

The loader does NOT import any group code — entry strings are
``module.path:attr`` references resolved lazily when the registry actually
loads the group (see ``wiring.py``).
"""

from __future__ import annotations

import logging
import pathlib
import tomllib
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

MANIFEST_FILENAME = "toolgroup.toml"

_REQUIRED_FIELDS: tuple[str, ...] = (
    "name",
    "version",
    "intents",
    "top_level_entry",
    "subagent_entry",
)
_KNOWN_FIELDS = frozenset({*_REQUIRED_FIELDS, "inherits", "tools"})


class ToolGroupManifestError(ValueError):
    """Raised when a toolgroup.toml is missing required fields, malformed,
    or violates an invariant (duplicate name / intent / unresolved inherits)."""


@dataclass(frozen=True)
class ToolGroupManifest:
    """An immutable, validated tool-group manifest.

    ``parent_manifest`` is populated on the second pass after every
    manifest in the directory has been parsed; it is ``None`` for groups
    that do not declare ``inherits``.

    ``metadata`` carries any TOML keys beyond the schema above, so
    applications can attach domain fields (lifecycle class, display
    labels, …) without forking the loader.
    """

    name: str
    version: str
    intents: tuple[str, ...]
    top_level_entry: str
    subagent_entry: str
    inherits: str | None = None
    tools: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)
    parent_manifest: ToolGroupManifest | None = None
    manifest_path: pathlib.Path = field(default_factory=pathlib.Path)


def _parse_manifest(path: pathlib.Path) -> ToolGroupManifest:
    """Parse a single TOML manifest file and validate required fields."""
    try:
        raw: dict[str, Any] = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ToolGroupManifestError(f"failed to parse {path}: {exc}") from exc

    for required in _REQUIRED_FIELDS:
        if required not in raw:
            raise ToolGroupManifestError(f"missing field '{required}' in {path}")

    intents = raw["intents"]
    if not isinstance(intents, list) or not all(isinstance(i, str) for i in intents):
        raise ToolGroupManifestError(f"field 'intents' must be a list of strings in {path}")

    inherits = raw.get("inherits")
    if inherits is not None and not isinstance(inherits, str):
        raise ToolGroupManifestError(f"field 'inherits' must be a string in {path}")

    tools = raw.get("tools", [])
    if not isinstance(tools, list) or not all(isinstance(t, str) for t in tools):
        raise ToolGroupManifestError(f"field 'tools' must be a list of strings in {path}")

    metadata = {k: v for k, v in raw.items() if k not in _KNOWN_FIELDS}

    return ToolGroupManifest(
        name=str(raw["name"]),
        version=str(raw["version"]),
        intents=tuple(intents),
        top_level_entry=str(raw["top_level_entry"]),
        subagent_entry=str(raw["subagent_entry"]),
        inherits=inherits,
        tools=tuple(tools),
        metadata=metadata,
        parent_manifest=None,
        manifest_path=path,
    )


def _check_duplicate_names(manifests: list[ToolGroupManifest]) -> None:
    seen: dict[str, pathlib.Path] = {}
    for m in manifests:
        if m.name in seen:
            raise ToolGroupManifestError(
                f"duplicate group name '{m.name}' in {seen[m.name]} and {m.manifest_path}"
            )
        seen[m.name] = m.manifest_path


def _check_intent_uniqueness(manifests: list[ToolGroupManifest]) -> None:
    intent_owner: dict[str, str] = {}
    for m in manifests:
        for intent in m.intents:
            if intent in intent_owner:
                raise ToolGroupManifestError(
                    f"duplicate intent '{intent}' in groups '{intent_owner[intent]}', '{m.name}'"
                )
            intent_owner[intent] = m.name


def _resolve_inheritance(manifests: list[ToolGroupManifest]) -> list[ToolGroupManifest]:
    by_name: dict[str, ToolGroupManifest] = {m.name: m for m in manifests}
    resolved: list[ToolGroupManifest] = []
    for m in manifests:
        if m.inherits is None:
            resolved.append(m)
            continue
        parent = by_name.get(m.inherits)
        if parent is None:
            raise ToolGroupManifestError(
                f"group '{m.name}' inherits unknown parent '{m.inherits}' "
                f"(manifest: {m.manifest_path})"
            )
        if parent.inherits is not None:
            raise ToolGroupManifestError(
                f"group '{m.name}' inherits '{parent.name}', which itself inherits "
                f"'{parent.inherits}' — inheritance is single-level only"
            )
        resolved.append(
            ToolGroupManifest(
                name=m.name,
                version=m.version,
                intents=m.intents,
                top_level_entry=m.top_level_entry,
                subagent_entry=m.subagent_entry,
                inherits=m.inherits,
                tools=m.tools,
                metadata=m.metadata,
                parent_manifest=parent,
                manifest_path=m.manifest_path,
            )
        )
    return resolved


def discover_tool_groups(root: pathlib.Path) -> list[ToolGroupManifest]:
    """Glob ``<root>/*/toolgroup.toml``, validate, return sorted manifests.

    Raises ``ToolGroupManifestError`` when any manifest is missing a
    required field, when two groups share a name, when intents collide
    across groups, or when a group's ``inherits`` target does not resolve
    to another (non-inheriting) group in the same root.
    """
    root = pathlib.Path(root)
    if not root.is_dir():
        raise ToolGroupManifestError(
            f"tool-group root does not exist or is not a directory: {root}"
        )

    manifest_paths = sorted(root.glob(f"*/{MANIFEST_FILENAME}"))
    parsed = [_parse_manifest(p) for p in manifest_paths]

    _check_duplicate_names(parsed)
    _check_intent_uniqueness(parsed)
    resolved = _resolve_inheritance(parsed)

    resolved.sort(key=lambda m: m.name)
    logger.debug("tool groups discovered under %s: %s", root, [m.name for m in resolved])
    return resolved
