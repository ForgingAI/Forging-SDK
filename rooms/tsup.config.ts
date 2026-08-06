// Build configuration for `@forging/rooms`.
//
// Two entry points, ESM-only, dual `.js` + `.d.ts` per entry. Peer deps and
// core deps stay external so consumer bundlers can dedupe across the
// dependency graph (especially `react` — multiple copies break hooks).
//
// We emit TWO tsup configs (array form):
//   1. Root entry `src/index.ts` → `dist/index.{js,d.ts}` (no banner)
//   2. Components entry `src/components/index.ts` → `dist/components/index.{js,d.ts}`
//      with a `"use client"` banner so React 19 + Next.js App Router treat the
//      module as a client component boundary.
//
// Root is intentionally banner-free: `defineRoom`, the wire-format schemas,
// and the runtime store are isomorphic and should run inside React Server
// Components or Node tooling without forcing a client boundary on consumers.
//
// See .planning/initiatives/multiplayer-platform/phase-01-rooms-infra/PLAN.md
//   - Sub-track 1.2 task 1.2.11 (SDK build + publish).

import { defineConfig, type Options } from "tsup";

const SHARED: Options = {
  format: ["esm"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
  minify: false,
  // React + react-dom MUST be external — multiple React copies break hooks.
  // `zod`, `immer`, and `partysocket` are externalized so the consumer's
  // bundler can dedupe them across the app's dependency graph.
  external: ["react", "react-dom", "zod", "immer", "partysocket"],
  // Keep declaration imports resolved through the package, not via internal
  // relative paths leaking into the published .d.ts files.
  outExtension: () => ({ js: ".js" }),
};

export default defineConfig([
  // ─── Root entry: schema, wire-format, runtime, factory ───────────────────
  {
    ...SHARED,
    entry: { index: "src/index.ts" },
    outDir: "dist",
    clean: true,
  },
  // ─── Components entry: React UI primitives (client-only) ─────────────────
  {
    ...SHARED,
    entry: { index: "src/components/index.ts" },
    outDir: "dist/components",
    // Do NOT re-clean dist — that would wipe the root build above.
    clean: false,
    // The `"use client";` directive is prepended by
    // `scripts/inject-use-client.sh` after the tsup build — tsup 8.5.x
    // drops per-config `banner` for the second array entry (verified
    // 2026-06-02). The post-build prepend is the documented
    // workaround; see that script's header for the full story.
  },
]);
