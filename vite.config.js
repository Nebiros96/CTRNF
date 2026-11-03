import { defineConfig } from "vite";
export default defineConfig({
  envDir: process.cwd(),
  root: "webapp",
  publicDir: "public",
  server: { host: "127.0.0.1" },
  build: { outDir: "../dist-web", emptyOutDir: true },
});
