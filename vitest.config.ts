import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    fileParallelism: false,
    env: {
      APP_SECRET: "test-secret-test-secret-test-secret-000",
      PHOTO_KEY: Buffer.alloc(32, 7).toString("base64"),
      STORAGE_DIR: "./.storage-test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://naya:naya@localhost:5432/naya_time_test",
    },
  },
});
