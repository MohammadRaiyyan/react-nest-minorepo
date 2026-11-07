import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev, the browser calls /api on the Vite server, and Vite forwards it to NestJS.
    // Same origin for the browser, so no CORS. Production does the same with a load balancer rule.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
