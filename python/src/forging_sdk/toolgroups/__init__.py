"""forging_sdk.toolgroups — declarative, lazily-loaded tool groups for LLM agents.

Extracted from the Forging builder agent's tool layer: a JSON-Schema tool
registry with deferred tool groups, TOML capability manifests with
single-level inheritance, a whitelist resolver for untrusted classifier
output, and typed scoped-subagent definitions. Stdlib-only.
"""

from .manifests import (
    MANIFEST_FILENAME,
    ToolGroupManifest,
    ToolGroupManifestError,
    discover_tool_groups,
)
from .registry import (
    LOAD_TOOLS_NAME,
    ToolCall,
    ToolDefinition,
    ToolRegistry,
    ToolResult,
)
from .resolver import available_group_names, resolve_group
from .stats import SurfaceStats, surface_stats
from .subagents import SubagentDefinition, validate_definitions
from .wiring import make_register_fn, register_groups, resolve_entry, select_manifests

__all__ = [
    "LOAD_TOOLS_NAME",
    "MANIFEST_FILENAME",
    "SubagentDefinition",
    "SurfaceStats",
    "ToolCall",
    "ToolDefinition",
    "ToolGroupManifest",
    "ToolGroupManifestError",
    "ToolRegistry",
    "ToolResult",
    "available_group_names",
    "discover_tool_groups",
    "make_register_fn",
    "register_groups",
    "resolve_entry",
    "resolve_group",
    "select_manifests",
    "surface_stats",
    "validate_definitions",
]
