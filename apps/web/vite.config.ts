import { createSessionAdapter } from "./server/session.mjs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "ailss-session",
      configureServer(server) {
        const handler = createSessionAdapter({
          gateway: process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080",
          origin: process.env.AILSS_WEB_ORIGIN || "http://127.0.0.1:5173",
        });
        server.middlewares.use((req, res, next) => {
          void handler(req, res)
            .then((handled) => {
              if (!handled) next();
            })
            .catch(next);
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080", changeOrigin: false },
    },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.tsx"] },
});
