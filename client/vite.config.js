import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    middlewareMode: false,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/embed": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/thumb": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/download": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/video-stream": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
