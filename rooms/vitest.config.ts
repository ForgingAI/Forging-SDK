// Vitest config for `@forging/rooms`.
//
// Tests in `test/runtime.test.ts` run pure logic and don't need a DOM, but
// the hook + component tests in `test/*.test.tsx` require jsdom for
// React rendering. We use `environmentMatchGlobs` to default to `node` and
// upgrade only the `.test.tsx` files to `jsdom`. The `@vitejs/plugin-react`
// plugin compiles JSX in the `.tsx` test files via SWC.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    environment: "node",
    environmentMatchGlobs: [
      ["test/**/*.test.tsx", "jsdom"],
    ],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
