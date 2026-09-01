import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Read the API Gateway base URL from OpenTofu output.
// This changes every time you reprovision, so we read it dynamically.
function getApiBaseUrl(): string {
  try {
    const url = execSync(
      "tofu -chdir=../tofu/api output -raw api_base_url",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    console.log(`  API proxy target: ${url}`);
    return url;
  } catch {
    console.warn(
      "  Warning: Could not read API base URL from tofu output.\n" +
        "  Make sure API module is provisioned. Using fallback."
    );
    return "http://localhost:4566/restapis/UNKNOWN/dev/_user_request_";
  }
}

// LocalStack S3 endpoint for static assets (class tree JSON).
const LOCALSTACK_S3 = "http://localhost:4566";
const FRONTEND_BUCKET = "swg-legends-frontend";

const apiBaseUrl = getApiBaseUrl();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: apiBaseUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Static reference data served from S3 (independent lifecycle from the app).
      // In production (S3 hosted), this file is a sibling in the same bucket,
      // so the relative URL /resource-class-tree.json resolves naturally.
      "/resource-class-tree.json": {
        target: `${LOCALSTACK_S3}/${FRONTEND_BUCKET}`,
        changeOrigin: true,
      },
    },
  },
});
