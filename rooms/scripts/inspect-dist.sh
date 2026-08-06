#!/usr/bin/env bash
# Post-build sanity check for `@forging/rooms`.
#
# Verifies that `pnpm run build` produced both entries plus their type
# declarations, that the `"use client"` banner landed on the components
# bundle, and that the key public symbols are present in the .d.ts output.
#
# Exits non-zero on any missing artifact or symbol so CI can fail fast.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${PKG_DIR}/dist"

fail() {
  printf '\033[31m[inspect-dist] FAIL:\033[0m %s\n' "$1" >&2
  exit 1
}

ok() {
  printf '\033[32m[inspect-dist] OK:\033[0m   %s\n' "$1"
}

# ─── Artifact existence ────────────────────────────────────────────────────

[ -d "${DIST}" ] || fail "dist/ directory missing — did you run 'pnpm run build'?"

for f in \
  "${DIST}/index.js" \
  "${DIST}/index.d.ts" \
  "${DIST}/index.js.map" \
  "${DIST}/components/index.js" \
  "${DIST}/components/index.d.ts" \
  "${DIST}/components/index.js.map"; do
  [ -f "${f}" ] || fail "missing artifact: ${f#"${PKG_DIR}/"}"
done
ok "all six expected artifacts exist"

# ─── 'use client' banner on the components bundle ──────────────────────────

if ! head -n 1 "${DIST}/components/index.js" | grep -Fq 'use client'; then
  fail "components/index.js is missing the 'use client' banner on line 1"
fi
ok "'use client' banner present on components bundle"

# Root entry must NOT carry the banner — keep it server-component safe.
if head -n 1 "${DIST}/index.js" | grep -Fq 'use client'; then
  fail "root index.js unexpectedly has a 'use client' banner — should be isomorphic"
fi
ok "root index.js is banner-free (isomorphic)"

# ─── Required public symbols in declarations ───────────────────────────────
#
# Symbols are matched on a non-word boundary on both sides so we tolerate
# every shape they appear in: function/class declarations followed by `(`
# or `<`, const declarations followed by `:`, and export-list entries
# followed by `,` or `}`.

ROOT_DTS="${DIST}/index.d.ts"
for sym in defineRoom createRoomApp RoomAppProvider PROTO_VERSION; do
  if ! grep -Eq "(^|[^A-Za-z0-9_])${sym}([^A-Za-z0-9_]|\$)" "${ROOT_DTS}"; then
    fail "root .d.ts missing expected symbol: ${sym}"
  fi
done
ok "root .d.ts exposes defineRoom / createRoomApp / RoomAppProvider / PROTO_VERSION"

COMPONENTS_DTS="${DIST}/components/index.d.ts"
for sym in JoinFlow Leaderboard PresenceStrip HostControlPanel; do
  if ! grep -Eq "(^|[^A-Za-z0-9_])${sym}([^A-Za-z0-9_]|\$)" "${COMPONENTS_DTS}"; then
    fail "components .d.ts missing expected symbol: ${sym}"
  fi
done
ok "components .d.ts exposes JoinFlow / Leaderboard / PresenceStrip / HostControlPanel"

# ─── Size summary ──────────────────────────────────────────────────────────

printf '\n[inspect-dist] dist size summary:\n'
du -h "${DIST}/index.js" "${DIST}/components/index.js"
printf '[inspect-dist] dist total:\n'
du -sh "${DIST}"

ok "dist looks healthy"
