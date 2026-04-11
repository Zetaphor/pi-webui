import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "client/index.html",
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
