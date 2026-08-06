"""Resolve an untrusted group-name candidate to a registered tool group.

When an LLM classifier picks which tool group should handle a request, its
output is untrusted free-form text — a misbehaving model could emit
``"../../etc/passwd"`` or ``"<script>"`` as a group name. ``resolve_group``
is the narrow whitelist gate between the classifier and every consumer of
that string (path components, log fields, database attributes): set
membership against the actually-discovered manifests, with an explicit
fallback.
"""

from __future__ import annotations

import pathlib

from .manifests import discover_tool_groups


def available_group_names(groups_root: pathlib.Path) -> list[str]:
    """Return the sorted list of discovered group names.

    Suitable for interpolating into a classifier prompt so the model names
    the exact set of valid choices.
    """
    return sorted(m.name for m in discover_tool_groups(groups_root))


def resolve_group(
    candidate: str | None,
    groups_root: pathlib.Path,
    fallback: str | None = None,
) -> str:
    """Validate ``candidate`` against the manifest set; fall back if unknown.

    Returns ``candidate`` when it exactly matches a discovered group name,
    otherwise ``fallback`` when that is a discovered group, otherwise the
    first group in sort order. Raises ``ToolGroupManifestError`` (via
    discovery) when the root is missing; raises ``ValueError`` when the
    root contains no groups at all.
    """
    names = set(available_group_names(groups_root))
    if not names:
        raise ValueError(f"no tool groups discovered under {groups_root}")
    if candidate and candidate in names:
        return candidate
    if fallback and fallback in names:
        return fallback
    return next(iter(sorted(names)))
