"""Tool registry — central catalogue of tools an LLM agent can invoke.

Read-only tools are safe to run concurrently; write tools are serialized.
Supports *deferred tool groups* that are loaded on demand via a synthesized
``load_tools`` meta-tool, keeping the initial schema payload sent to the
model small.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

LOAD_TOOLS_NAME = "load_tools"


@dataclass(frozen=True)
class ToolDefinition:
    """A single tool the agent can call."""

    name: str
    description: str
    input_schema: dict[str, Any]  # JSON Schema
    handler: Callable[..., Coroutine[Any, Any, dict[str, Any]]]
    read_only: bool = False


@dataclass(frozen=True)
class ToolCall:
    """Parsed tool invocation from the model response."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    """Outcome of a tool execution."""

    tool_call_id: str
    name: str
    content: dict[str, Any]
    is_error: bool = False
    duration_ms: int = 0


# A deferred registration function receives the registry and registers
# the group's tools onto it.
DeferredRegisterFn = Callable[["ToolRegistry"], None]


class ToolRegistry:
    """Stores tool definitions, validates calls, executes them.

    Supports deferred tool groups: groups of tools that are not sent to
    the model until the agent explicitly calls ``load_tools(group="...")``
    — or calls one of the group's tools directly, which auto-loads it.

    ``externally_routed`` names tools that this registry must never
    execute itself (e.g. subagent spawns handled by an outer runtime).
    ``execute_batch`` surfaces an error result for them instead of
    executing, as a defense-in-depth backstop for routing bugs upstream.
    """

    def __init__(self, externally_routed: frozenset[str] = frozenset()) -> None:
        self._tools: dict[str, ToolDefinition] = {}
        self._externally_routed = externally_routed
        # Deferred groups: name → (description, register_fn)
        self._deferred: dict[str, tuple[str, DeferredRegisterFn]] = {}
        self._loaded_groups: set[str] = set()
        # Reverse map: tool_name → group_name (for auto-loading)
        self._tool_to_group: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, tool: ToolDefinition) -> None:
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' is already registered")
        self._tools[tool.name] = tool
        logger.debug("tool registered: %s (read_only=%s)", tool.name, tool.read_only)

    def register_deferred_group(
        self,
        group: str,
        description: str,
        register_fn: DeferredRegisterFn,
        tool_names: list[str] | None = None,
    ) -> None:
        """Register a group of tools that will be loaded on demand.

        If *tool_names* is provided, builds a reverse map so the group
        is auto-loaded when the model calls one of those tools directly.
        """
        self._deferred[group] = (description, register_fn)
        if tool_names:
            for name in tool_names:
                self._tool_to_group[name] = group
        logger.debug("deferred group registered: %s", group)

    def load_group(self, group: str) -> list[str]:
        """Activate a deferred tool group, returning the tool names added."""
        if group in self._loaded_groups:
            return []  # already loaded
        entry = self._deferred.get(group)
        if entry is None:
            available = ", ".join(sorted(self._deferred.keys()))
            raise ValueError(f"Unknown tool group: {group!r}. Available: {available}")
        _description, register_fn = entry
        before = set(self._tools.keys())
        register_fn(self)
        after = set(self._tools.keys())
        added = sorted(after - before)
        self._loaded_groups.add(group)
        logger.info("tool group loaded: %s → %s", group, added)
        return added

    @property
    def pending_groups(self) -> dict[str, str]:
        """Return group_name → description for groups not yet loaded."""
        return {
            name: desc
            for name, (desc, _) in self._deferred.items()
            if name not in self._loaded_groups
        }

    @property
    def tool_names(self) -> list[str]:
        """Sorted names of currently-registered (loaded) tools."""
        return sorted(self._tools.keys())

    def get(self, name: str) -> ToolDefinition | None:
        return self._tools.get(name)

    def list_schemas(self) -> list[dict[str, Any]]:
        """Return tool definitions formatted for the OpenAI-style ``tools`` param.

        Includes the built-in ``load_tools`` meta-tool when deferred groups
        remain unloaded.
        """
        schemas: list[dict[str, Any]] = []
        for tool in self._tools.values():
            schemas.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    },
                }
            )

        pending = self.pending_groups
        if pending:
            group_list = ", ".join(f"{name} ({desc})" for name, desc in sorted(pending.items()))
            schemas.append(
                {
                    "type": "function",
                    "function": {
                        "name": LOAD_TOOLS_NAME,
                        "description": (
                            f"Load additional tool groups. Available: {group_list}. "
                            "Call this before using tools from that group."
                        ),
                        "parameters": {
                            "type": "object",
                            "required": ["group"],
                            "properties": {
                                "group": {
                                    "type": "string",
                                    "description": "Tool group to load",
                                    "enum": sorted(pending.keys()),
                                },
                            },
                        },
                    },
                }
            )
        return schemas

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        """Execute a single tool by name and return a ToolResult.

        If the tool belongs to a deferred group that hasn't been loaded
        yet, auto-load the group first. This lets the model call any
        tool by name without needing to know about ``load_tools``.
        """
        tool = self._tools.get(name)
        if tool is None:
            group = self._tool_to_group.get(name)
            if group and group not in self._loaded_groups:
                self.load_group(group)
                tool = self._tools.get(name)
            if tool is None:
                return ToolResult(
                    tool_call_id="",
                    name=name,
                    content={"error": f"Unknown tool: {name}"},
                    is_error=True,
                )

        start = time.monotonic()
        try:
            result = await tool.handler(**arguments)
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.info("tool executed: %s (%dms)", name, elapsed_ms)
            return ToolResult(
                tool_call_id="",
                name=name,
                content=result,
                duration_ms=elapsed_ms,
            )
        except Exception as exc:  # noqa: BLE001 — tool errors become results
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("tool failed: %s (%dms): %s", name, elapsed_ms, exc)
            return ToolResult(
                tool_call_id="",
                name=name,
                content={"error": str(exc)},
                is_error=True,
                duration_ms=elapsed_ms,
            )

    async def execute_batch(self, calls: list[ToolCall]) -> list[ToolResult]:
        """Execute a batch of tool calls in three lanes.

        Lane 1 — read-only tools: concurrent via ``asyncio.gather``.
        Lane 2 — externally-routed tools: never executed here; each
                 surfaces an error result telling the caller to route
                 through its own runtime (defense-in-depth backstop).
        Lane 3 — write tools: serial, in call order.
        """
        read_calls: list[ToolCall] = []
        external_calls: list[ToolCall] = []
        write_calls: list[ToolCall] = []

        for call in calls:
            # The externally-routed split must run before the read_only
            # check so a routed tool marked read_only can't slip into the
            # concurrent lane and execute here.
            if call.name in self._externally_routed:
                external_calls.append(call)
                continue
            tool = self._tools.get(call.name)
            if tool is not None and tool.read_only:
                read_calls.append(call)
            else:
                write_calls.append(call)

        results: list[ToolResult] = []

        if read_calls:
            read_tasks = [self._execute_call(c) for c in read_calls]
            results.extend(await asyncio.gather(*read_tasks, return_exceptions=False))

        for call in external_calls:
            results.append(
                ToolResult(
                    tool_call_id=call.id,
                    name=call.name,
                    content={
                        "error": (
                            f"{call.name} is declared externally routed and must be "
                            "handled by the caller's runtime, not the registry. "
                            "Reaching execute_batch indicates a routing bug."
                        ),
                    },
                    is_error=True,
                )
            )

        for call in write_calls:
            results.append(await self._execute_call(call))

        return results

    async def _execute_call(self, call: ToolCall) -> ToolResult:
        """Execute a ToolCall and stamp its id onto the result."""
        result = await self.execute(call.name, call.arguments)
        return ToolResult(
            tool_call_id=call.id,
            name=result.name,
            content=result.content,
            is_error=result.is_error,
            duration_ms=result.duration_ms,
        )
