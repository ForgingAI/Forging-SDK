"""Wiring: register manifest-discovered groups onto a ToolRegistry.

Entry strings in manifests are ``module.path:attr`` references to a
callable ``(registry, config) -> None``. They are resolved lazily — group
code is only imported when the registry actually loads the group.

Manifest-declared inheritance is honored here: when a group is loaded,
its parent's top-level tools are registered first, then the child's own
tools layer on top.
"""

from __future__ import annotations

import importlib
import pathlib
from collections.abc import Callable
from typing import Any

from .manifests import ToolGroupManifest, discover_tool_groups
from .registry import ToolRegistry


def resolve_entry(entry: str) -> Callable[..., None]:
    """Resolve a ``module.path:attr`` string from a manifest into a callable."""
    module_path, _, attr = entry.partition(":")
    if not module_path or not attr:
        raise ValueError(f"Invalid manifest entry {entry!r}; expected 'module.path:attr'")
    module = importlib.import_module(module_path)
    return getattr(module, attr)


def make_register_fn(
    manifest: ToolGroupManifest,
    config: Any,
) -> Callable[[ToolRegistry], None]:
    """Build the deferred-group registration closure for one manifest.

    Honors ``inherits`` by registering the parent's top-level tools first;
    the child group then layers its own tools on top.
    """

    def _register(registry: ToolRegistry) -> None:
        if manifest.parent_manifest is not None:
            parent_fn = resolve_entry(manifest.parent_manifest.top_level_entry)
            parent_fn(registry, config)
        child_fn = resolve_entry(manifest.top_level_entry)
        child_fn(registry, config)

    return _register


def select_manifests(
    manifests: list[ToolGroupManifest],
    include: frozenset[str] | None = None,
    exclude: frozenset[str] = frozenset(),
) -> list[ToolGroupManifest]:
    """Filter manifests by group name: allowlist first, then denylist.

    Raises ``ValueError`` when a named group doesn't exist, so a typo in a
    capability flag fails loudly instead of silently serving the wrong set.
    A group kept by the filter may still ``inherit`` an excluded parent —
    inheritance is a registration detail, not an exposed capability.
    """
    known = {m.name for m in manifests}
    unknown = (set(include or ()) | set(exclude)) - known
    if unknown:
        raise ValueError(f"unknown group(s) {sorted(unknown)}; available: {sorted(known)}")
    selected = [m for m in manifests if include is None or m.name in include]
    return [m for m in selected if m.name not in exclude]


def register_groups(
    registry: ToolRegistry,
    groups_root: pathlib.Path,
    config: Any = None,
    include: frozenset[str] | None = None,
    exclude: frozenset[str] = frozenset(),
) -> list[ToolGroupManifest]:
    """Discover every group under ``groups_root`` and register each as a
    deferred group on ``registry``. Returns the registered manifests.

    ``config`` is passed through opaquely to each group's entry callable —
    use it for whatever application context your tools need.

    ``include``/``exclude`` toggle capabilities by group name without
    touching manifests — an allowlist (``None`` = all) and a denylist.

    Groups that declare a ``tools = [...]`` list in their manifest are
    auto-loaded when the model calls one of those tools directly, without
    an explicit ``load_tools`` round-trip.
    """
    manifests = select_manifests(discover_tool_groups(groups_root), include, exclude)
    for manifest in manifests:
        registry.register_deferred_group(
            group=manifest.name,
            description=f"v{manifest.version} — intents: {', '.join(manifest.intents)}",
            register_fn=make_register_fn(manifest, config),
            tool_names=list(manifest.tools) or None,
        )
    return manifests
