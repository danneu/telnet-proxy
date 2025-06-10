import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "node:test": "vitest",
    },
  },
});
