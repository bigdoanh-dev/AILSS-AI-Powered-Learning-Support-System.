import { createSessionAdapter } from "./server/session.mjs";
import { attachAiRealtime } from "./server/realtime.mjs";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, repositoryRoot, ""),
    ...loadEnv(mode, process.cwd(), ""),
    ...process.env,
  };
  const gateway = env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080";
  const origin = env.AILSS_WEB_ORIGIN || "http://127.0.0.1:5173";

  return {
    plugins: [
      react(),
      {
        name: "ailss-session",
        configureServer(server) {
          const handler = createSessionAdapter({
            gateway,
            origin,
            googleClientId: env.GOOGLE_WEB_CLIENT_ID || "",
            appleClientId: env.APPLE_WEB_CLIENT_ID || "",
            appleRedirectUri: env.APPLE_WEB_REDIRECT_URI || "",
          });
          if (server.httpServer) attachAiRealtime(server.httpServer, handler, origin);
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
        "/api": { target: gateway, changeOrigin: false },
      },
    },
    test: { environment: "jsdom", include: ["tests/**/*.test.tsx"] },
  };
});
