import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "hal.localhost",
    port: 9000,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:9001",
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "hal.localhost",
    port: 9000,
    strictPort: true
  }
});
