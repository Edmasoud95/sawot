import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // dev mode: proxy the voice WebSocket to the FastAPI server
    proxy: { "/ws": { target: "ws://localhost:8765", ws: true } },
  },
});
