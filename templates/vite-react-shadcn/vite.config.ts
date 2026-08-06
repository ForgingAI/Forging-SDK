import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base ensures built assets work when deployed to any URL
  // prefix (S3 subpath, subdirectory, etc.) without path rewriting.
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 3000,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
