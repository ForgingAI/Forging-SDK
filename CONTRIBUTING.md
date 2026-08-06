# Contributing to Forging-SDK

Thanks for thinking about contributing.

> 🚧 The SDK is in **alpha**. APIs may change between releases; check the changelog before upgrading.

## Scope

This repo holds the **capability surface** that apps generated on Forging consume. Things that belong here:

- New hooks / primitives every app would use (e.g., `useStorage`, `useAI`)
- Wire-format schemas + types
- Reference apps that demonstrate idiomatic usage
- Templates that Hephaestus generates from
- Plugin authoring SDKs

Things that **don't** belong here:

- Server-side implementations (those live in private repos)
- Forging-specific deployment / billing / auth internals
- Anything that requires Forging's AWS or Cloudflare accounts to run

## Workflow

1. Open an issue describing the capability or template you want to add. Pre-discuss the API surface before writing code.
2. Fork + branch from `main`. Use `feat/...` or `fix/...` prefixes.
3. Each subdirectory has its own tooling (`rooms/` uses Bun + Vitest + tsup; `python/` uses uv + pytest + ruff). Run their local checks before pushing.
4. Add tests. Especially for `rooms/` — wire-format changes can break every app silently if untested.
5. Open a PR. CI runs lint + type + tests per subdirectory (path-scoped).

## Local setup

```bash
git clone https://github.com/ForgingAI/Forging-SDK
cd Forging-SDK

# TS SDK
cd rooms && bun install && bun run test

# Python SDK
cd ../python && uv sync && uv run pytest

# Templates / examples
cd ../examples/apps/trivia && bun install
```

## Code style

- TypeScript: strict mode, no `any`, prefer `unknown` + type narrowing. Zod for runtime validation at boundaries.
- Python: PEP 8, type annotations on public functions, ruff for lint + format.
- All public exports must have docstrings/JSDoc.

## Reporting issues

For security issues, do not open a public issue — see [SECURITY.md](./SECURITY.md).

For everything else: GitHub issues. Include the SDK version (commit SHA), what you tried, what happened, what you expected.
