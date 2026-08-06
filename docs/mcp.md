# Serving tool groups over MCP

Any [tool-group directory](toolgroups.md) can be exposed as a
[Model Context Protocol](https://modelcontextprotocol.io) server, so the same
capability bundles your agent uses internally are directly attachable to
Claude Code, Claude Desktop, Cursor, or any MCP client.

## Why

- **Deferred capability loading.** Flat MCP servers push every tool schema to
  the client's model on every session. Here, each group's schemas are only
  paid for after the model calls `load_tools` — the initial surface is one
  small meta-tool regardless of how many groups the server carries.
- **Mid-session expansion.** Loading a group emits `tools/list_changed`; the
  client refreshes its tool list live — no reconfiguration or restart.
- **Per-client capability control.** `--enable` / `--disable` scope the served
  groups from the command line (see below).
- **One artifact, two consumers.** The same `toolgroup.toml` bundles drive
  your in-process agent loop and every MCP client.

## Install

```bash
pip install "forging-sdk[mcp] @ git+https://github.com/ForgingAI/Forging-SDK#subdirectory=python"
```

(or from a clone: `pip install -e "python[mcp]"`)

## Serve a groups directory

```bash
forging mcp --groups-root ./groups
```

- Deferred groups appear to the client through the standard `load_tools`
  meta-tool; when the model loads one, the server emits a
  `tools/list_changed` notification so the client refreshes.
- Pass `--eager` to load every group at startup instead (all tools visible
  immediately).
- Group modules that live inside the groups root are importable
  automatically — no packaging required.

## Turning capabilities on and off

Scope what a client can see without editing any manifest:

```bash
forging mcp --groups-root ./groups --enable notes --enable calc   # allowlist
forging mcp --groups-root ./groups --disable deploy               # denylist
```

`--enable` (repeatable) serves only the named groups; `--disable`
(repeatable) removes groups and is applied after `--enable`. Unknown names
fail loudly rather than silently serving the wrong set. Run different
clients against the same directory with different flags to give each a
different capability surface.

## Quantify it

`--stats` measures the initial tool-schema payload for your selection, eager
vs deferred, and exits:

```bash
forging mcp --groups-root examples/toolgroups --stats
```

Real output for the bundled demo groups:

```text
Tool surface for examples/toolgroups (2 groups: calc, notes)
  eager:    3 tool schemas, 685 bytes (~171 est. tokens)
  deferred: 1 tool schema(s), 443 bytes (~110 est. tokens)
  initial-surface reduction: 35.3%
```

The deferred surface is near-constant (one meta-tool whose description lists
the group names), so the reduction grows with every group and tool you add —
the demo's 35% is the floor, not the ceiling. Token counts are estimated at
4 chars/token and labeled as such; run it on your own groups directory for
your real numbers.

## Try the bundled demo

From the repo root:

```bash
forging mcp --groups-root examples/toolgroups
```

This serves a `notes` group (`save_note`, `list_notes`) and a `calc` group
(`calculate`).

## Client configuration

Claude Code:

```bash
claude mcp add my-tools -- forging mcp --groups-root /abs/path/to/groups
```

Claude Desktop / Cursor (`mcpServers` JSON):

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "forging",
      "args": ["mcp", "--groups-root", "/abs/path/to/groups"]
    }
  }
}
```

## Programmatic use

```python
from forging_sdk.toolgroups import ToolRegistry, register_groups
from forging_sdk.toolgroups.mcp import serve_stdio

registry = ToolRegistry()
register_groups(registry, groups_root)
await serve_stdio(registry, name="my-tools")
```

`build_mcp_server(registry)` returns the underlying low-level `mcp` server if
you want to mount it on a different transport.
