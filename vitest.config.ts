import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { PAYMENT_MODE: "simulation" },
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
