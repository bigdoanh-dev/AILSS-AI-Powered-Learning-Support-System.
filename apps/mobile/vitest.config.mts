import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "expo-video": path.resolve(__dirname, "src/__mocks__/expo-video.ts"),
      "@expo/vector-icons": path.resolve(__dirname, "src/__mocks__/expo-vector-icons.tsx"),
      "@expo/vector-icons/Ionicons": path.resolve(__dirname, "src/__mocks__/expo-vector-icons.tsx"),
      "expo-image-picker": path.resolve(__dirname, "src/__mocks__/expo-image-picker.ts"),
    },
  },
});
