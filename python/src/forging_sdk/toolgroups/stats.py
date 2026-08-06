"""Quantify the tool-surface cost of eager vs deferred group loading.

Every tool schema a server exposes is context the client's model pays for on
every request that lists tools. ``surface_stats`` measures that cost for a
groups directory both ways — all groups loaded up front vs deferred behind
``load_tools`` — so the reduction is a number, not a claim.

Token counts are estimated at 4 characters/token and labeled as estimates.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass
from typing import Any

from .registry import ToolRegistry
from .wiring import register_groups

_CHARS_PER_TOKEN = 4


@dataclass(frozen=True)
class Surface:
    """One measured tool surface."""

    tool_count: int
    schema_bytes: int

    @property
    def est_tokens(self) -> int:
        return self.schema_bytes // _CHARS_PER_TOKEN


@dataclass(frozen=True)
class SurfaceStats:
    """Eager-vs-deferred comparison for one groups directory."""

    group_names: tuple[str, ...]
    eager: Surface
    deferred: Surface

    @property
    def reduction_pct(self) -> float:
        if self.eager.schema_bytes == 0:
            return 0.0
        saved = self.eager.schema_bytes - self.deferred.schema_bytes
        return 100.0 * saved / self.eager.schema_bytes


def _measure(registry: ToolRegistry) -> Surface:
    schemas = registry.list_schemas()
    return Surface(
        tool_count=len(schemas),
        schema_bytes=len(json.dumps(schemas).encode("utf-8")),
    )


def surface_stats(
    groups_root: pathlib.Path,
    config: Any = None,
    include: frozenset[str] | None = None,
    exclude: frozenset[str] = frozenset(),
) -> SurfaceStats:
    """Measure the initial tool surface eager vs deferred.

    Note: the eager measurement imports and registers every selected group
    (that is what eager loading means).
    """
    deferred_registry = ToolRegistry()
    manifests = register_groups(deferred_registry, groups_root, config, include, exclude)

    eager_registry = ToolRegistry()
    register_groups(eager_registry, groups_root, config, include, exclude)
    for manifest in manifests:
        eager_registry.load_group(manifest.name)

    return SurfaceStats(
        group_names=tuple(m.name for m in manifests),
        eager=_measure(eager_registry),
        deferred=_measure(deferred_registry),
    )


def render_stats(stats: SurfaceStats, groups_root: pathlib.Path) -> str:
    """Human-readable report for the CLI."""
    lines = [
        f"Tool surface for {groups_root} ({len(stats.group_names)} groups: "
        f"{', '.join(stats.group_names)})",
        f"  eager:    {stats.eager.tool_count} tool schemas, "
        f"{stats.eager.schema_bytes:,} bytes (~{stats.eager.est_tokens:,} est. tokens)",
        f"  deferred: {stats.deferred.tool_count} tool schema(s), "
        f"{stats.deferred.schema_bytes:,} bytes (~{stats.deferred.est_tokens:,} est. tokens)",
        f"  initial-surface reduction: {stats.reduction_pct:.1f}%",
        "",
        "Deferred is what an MCP client pays before any capability is used;",
        "each group's schemas are only paid for after load_tools pulls it in.",
    ]
    return "\n".join(lines)
