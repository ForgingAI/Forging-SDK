# Forging-SDK

The open capability layer of the [Forging](https://forging.dev) platform —
what generated apps consume, what plugin authors extend, and a set of
agent-infrastructure primitives you can use in **any** LLM agent, no Forging
account required.

MIT licensed.

## Use it standalone (no Forging required)

**`forging_sdk.toolgroups`** — declarative, lazily-loaded tool groups for LLM
agents. A JSON-Schema tool registry where capabilities are TOML-manifest
bundles the model loads on demand (via a synthesized `load_tools` meta-tool or
by calling a deferred tool directly), with single-level group inheritance, a
whitelist resolver for untrusted classifier output, and typed scoped-subagent
definitions. Zero runtime dependencies. → [docs/toolgroups.md](docs/toolgroups.md)

```python
from forging_sdk.toolgroups import ToolRegistry, register_groups

registry = ToolRegistry()
register_groups(registry, groups_root)          # discovers */toolgroup.toml
schemas = registry.list_schemas()               # small surface + load_tools
results = await registry.execute_batch(calls)   # read-concurrent / write-serial
```

**MCP server** — any tool-group directory is directly attachable to Claude
Code, Claude Desktop, or Cursor:

```bash
pip install "forging-sdk[mcp] @ git+https://github.com/ForgingAI/Forging-SDK#subdirectory=python"
forging mcp --groups-root examples/toolgroups   # bundled demo groups
```

Why serve tools this way instead of a flat MCP server?

- **Pay for capabilities only when used.** A flat server sends every tool
  schema to the model up front; here, groups sit behind one `load_tools`
  meta-tool until the model actually needs them. The deferred surface stays
  near-constant no matter how many groups you serve — and it's measurable,
  not a vibe: `forging mcp --groups-root <dir> --stats` prints the eager vs
  deferred schema payload and % reduction for *your* tools (the tiny bundled
  demo already measures 35% smaller; real multi-group agents save far more).
- **The model self-serves capabilities mid-session.** Loading a group fires
  `tools/list_changed`, the client refreshes — no reconfiguration, no restart.
- **Capability toggles per client.** `--enable`/`--disable` flags scope which
  groups a given client can see, from the command line, without touching
  manifests — one groups directory, different surfaces for different contexts.
- **Write once, use twice.** The same bundles power your own agent loop via
  the registry API and any MCP client via `forging mcp`.

→ [docs/mcp.md](docs/mcp.md)

## Use it with Forging

| Path | What |
|------|------|
| `rooms/` | `@forging/rooms` — React hooks + Zod schemas + wire-format types for realtime multiplayer rooms. Apps `import { useRoomState, useRoomPresence } from '@forging/rooms'`. |
| `python/` | `forging-sdk` — Python SDK for plugin authors: register content types, intent handlers, lifecycle hooks, and builder tools. Includes `forging_sdk.toolgroups` above. |
| `templates/` | App scaffolds Forging generates from (`vite-react-shadcn`, `vite-react-ai-chat`) — working starters hardened for LLM extension. |
| `examples/apps/` | Reference apps. `trivia/` shows a multiplayer app built on `@forging/rooms`. |
| `examples/plugins/` | Reference plugins. `haiku-poem/` registers a new content type via the Python SDK. |
| `examples/toolgroups/` | Runnable demo tool group for the MCP server. |
| `docs/` | Usage docs. |

Forging is a platform where users describe what they want and an agent
(Hephaestus) generates a real, deployable app. Every generated app needs a
stable, well-typed surface to import from — that surface is this repo. If you
fork an app generated on Forging, this is the only dependency you need to
understand to keep building on it.

## What's **not** in here

- Server implementations (FastAPI backend, rooms infrastructure) — private.
- The orchestrator + builder agent runtime — private.
- Production secrets, account IDs, deployment scripts — never.

This SDK defines *what apps and agents can do*. The private repos define
*how Forging runs that at scale*.

## Development

```bash
cd python
uv sync --all-extras
uv run pytest        # includes toolgroups + MCP adapter tests
uv run ruff check .
```

Rooms (TypeScript):

```bash
cd rooms
bun install && bun run test
```

## Distribution

Not on PyPI or npm yet — install from source (pin a commit SHA for
reproducibility). Publishes are planned once the APIs stabilize.

`forging-sdk` (Python):

```bash
pip install "forging-sdk[mcp] @ git+https://github.com/ForgingAI/Forging-SDK#subdirectory=python"
```

(or clone and `pip install -e "python[mcp]"`; drop `[mcp]` if you don't need
the MCP server)

`@forging/rooms` (TypeScript) — build a local tarball:

```bash
git clone https://github.com/ForgingAI/Forging-SDK && cd Forging-SDK/rooms
bun install && bun run build && npm pack        # → forging-rooms-0.1.0.tgz
```

then `bun add file:/path/to/forging-rooms-0.1.0.tgz` from your app.

## Contributing

See `CONTRIBUTING.md`. The SDK is intentionally narrow: every export should
be something a generated app, a plugin author, or an agent builder would
import directly. For new capabilities, open an issue describing the use case
first.

## License

MIT (see `LICENSE`).
