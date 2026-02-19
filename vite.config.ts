import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "esnext",
    sourcemap: "hidden",
    minify: "esbuild",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: [
            "@xterm/xterm",
            "@xterm/addon-fit",
            "@xterm/addon-image",
            "@xterm/addon-unicode11",
            "@xterm/addon-web-links",
            "@xterm/addon-webgl",
          ],
        },
      },
    },
  },
}));
