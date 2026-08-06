#!/usr/bin/env bash
# Prepend the `"use client";` directive to the components bundle.
#
# tsup 8.5.x silently drops the per-config `banner` option for the
# second entry in array-mode tsup.config.ts files (verified 2026-06-02
# — both `banner: { js: ... }` and `esbuildOptions(o => o.banner = ...)`
# no-op for the components entry). The components bundle MUST carry
# the directive so React 19 + Next.js App Router treat it as a client
# component boundary; without it, importing any of our components
# inside a Server Component is a runtime error.
#
# This script is the post-build belt-and-suspenders fix. It runs as
# part of `npm run build` and is idempotent — re-running on an
# already-tagged bundle is a no-op.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${PKG_DIR}/dist/components/index.js"

[ -f "${TARGET}" ] || {
  echo "[inject-use-client] FAIL: ${TARGET} does not exist (did tsup run?)" >&2
  exit 1
}

# Idempotency guard — if the directive is already line 1, exit clean.
if head -n 1 "${TARGET}" | grep -q '^"use client";'; then
  echo "[inject-use-client] OK: banner already present"
  exit 0
fi

TMP="$(mktemp)"
printf '"use client";\n' > "${TMP}"
cat "${TARGET}" >> "${TMP}"
mv "${TMP}" "${TARGET}"

echo "[inject-use-client] OK: prepended \"use client\"; directive"
