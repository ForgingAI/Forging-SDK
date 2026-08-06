"""SubagentDefinition — a typed schema for scoped inner-loop subagents.

A subagent is an inner agent loop spawned by an outer agent, given a
narrow system prompt and a *scoped tool subset* rather than the full
registry. This module provides only the definition schema; the runtime
that executes subagents is application-specific.

Two invariants worth enforcing in your definitions (validated by
``validate_definitions``):

- **No recursion:** a subagent's ``tool_subset`` must not contain the
  tool(s) your outer loop uses to spawn subagents.
- **Termination contract:** every subagent needs an explicit "done" tool
  in its subset so the inner loop has a structured way to end.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class SubagentDefinition:
    """A single subagent type — name, prompt, scoped tool subset, caps."""

    name: str
    description: str
    system_prompt: str
    tool_subset: tuple[str, ...]
    model: str
    max_iterations: int = 10
    token_budget: int = 8000
    max_retries: int = 3


def validate_definitions(
    definitions: Iterable[SubagentDefinition],
    spawn_tools: frozenset[str],
    done_tool: str,
) -> None:
    """Enforce the no-recursion and termination invariants.

    Raises ``ValueError`` naming the offending definition when a
    ``tool_subset`` contains a spawn tool (recursion) or lacks the
    ``done_tool`` (no structured termination).
    """
    for definition in definitions:
        subset = set(definition.tool_subset)
        banned = subset & spawn_tools
        if banned:
            raise ValueError(
                f"subagent '{definition.name}' includes spawn tool(s) "
                f"{sorted(banned)} — recursion is banned"
            )
        if done_tool not in subset:
            raise ValueError(
                f"subagent '{definition.name}' is missing termination tool "
                f"'{done_tool}' in tool_subset"
            )
