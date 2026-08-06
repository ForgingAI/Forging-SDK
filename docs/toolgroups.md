# Tool groups — declarative, lazily-loaded capabilities for LLM agents

`forging_sdk.toolgroups` is the tool layer extracted from Forging's builder
agent. It solves a scaling problem every multi-capability agent hits: **the
more tools you register, the more context each turn burns and the worse the
model's tool selection gets.** Instead of sending every schema every turn,
you ship a small core surface and let the model pull in capability groups on
demand.

Zero runtime dependencies — Python 3.11+ stdlib only.

```bash
pip install "forging-sdk @ git+https://github.com/ForgingAI/Forging-SDK#subdirectory=python"
```

## Concepts

| Concept | What it is |
|---|---|
| `ToolDefinition` | One tool: name, description, JSON-Schema input, async handler, `read_only` flag |
| `ToolRegistry` | Registers tools, validates calls, executes them |
| Tool group | A directory with a `toolgroup.toml` manifest + a registration function |
| Deferred group | A group the registry knows about but hasn't imported/registered yet |
| `load_tools` | A meta-tool the registry synthesizes while deferred groups remain — the model calls it to expand its own tool surface |
| `SubagentDefinition` | A typed spec for a scoped inner agent: narrow prompt + narrow tool subset |

## Defining a group

```
groups/
└── website/
    ├── toolgroup.toml
    └── __init__.py        # or any importable module
```

`toolgroup.toml`:

```toml
name = "website"
version = "1.0"
intents = ["build a site", "landing page"]        # used for intent routing
top_level_entry = "my_agent.groups.website:register_top_level"
subagent_entry = "my_agent.groups.website:register_as_subagent"

# optional
inherits = "base"                # single-level: parent registers first
tools = ["scaffold", "deploy"]   # direct calls to these auto-load the group
any_custom_key = "..."           # lands in manifest.metadata, yours to use
```

The entry points are `module.path:function` strings resolved **lazily** — a
group's code is never imported until the group actually loads.

```python
# my_agent/groups/website/__init__.py
from forging_sdk.toolgroups import ToolDefinition

async def scaffold(framework: str) -> dict:
    ...
    return {"created": True}

def register_top_level(registry, config):
    registry.register(ToolDefinition(
        name="scaffold",
        description="Create a new project skeleton.",
        input_schema={
            "type": "object",
            "required": ["framework"],
            "properties": {"framework": {"type": "string"}},
        },
        handler=scaffold,
    ))
```

## Wiring it into an agent loop

```python
from pathlib import Path
from forging_sdk.toolgroups import ToolRegistry, register_groups

registry = ToolRegistry()
register_groups(registry, groups_root=Path("groups"), config=my_config)

schemas = registry.list_schemas()
# → your eagerly-registered core tools
#   + one `load_tools` meta-tool describing every pending group

# model responds with tool calls →
results = await registry.execute_batch(calls)
```

Three execution lanes in `execute_batch`:

1. **Read-only tools** run concurrently (`asyncio.gather`).
2. **Externally-routed tools** (declare via
   `ToolRegistry(externally_routed=frozenset({"spawn_subagent"}))`) are never
   executed by the registry — they surface an explicit error result so a
   routing bug upstream can't cause a subagent spawn to run in the wrong
   runtime.
3. **Write tools** run serially, in call order.

If the model calls a deferred tool directly (listed in the manifest's
`tools = [...]`), the group auto-loads — no `load_tools` round-trip needed.

## Routing untrusted classifier output

If a classifier picks which group should own a request, its output is
untrusted LLM text. Gate it:

```python
from forging_sdk.toolgroups import available_group_names, resolve_group

choices = available_group_names(groups_root)          # for the classifier prompt
group = resolve_group(model_output, groups_root, fallback="website")
```

`resolve_group` is strict set membership — `"../../etc/passwd"` resolves to
your fallback, never to a path component.

## Scoped subagents

Groups declare a `subagent_entry` so another agent can spawn them as a scoped
inner loop with only that group's tools. Describe your subagent types with
`SubagentDefinition` and enforce the two invariants that keep inner loops
safe:

```python
from forging_sdk.toolgroups import SubagentDefinition, validate_definitions

DEFINITIONS = (
    SubagentDefinition(
        name="researcher",
        description="Read-only workspace exploration",
        system_prompt="...",
        tool_subset=("read_file", "search", "subagent_done"),
        model="your/cheap-model",
        token_budget=8000,
    ),
)

validate_definitions(
    DEFINITIONS,
    spawn_tools=frozenset({"spawn_subagent"}),  # no recursive spawning
    done_tool="subagent_done",                  # structured termination
)
```

## Serving groups over MCP

Any groups directory can also be exposed to Claude Code / Claude Desktop /
Cursor as an MCP server — see [docs/mcp.md](mcp.md).
