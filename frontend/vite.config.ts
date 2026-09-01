import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

// Read the API Gateway base URL from OpenTofu output.
// This changes every time you reprovision, so we read it dynamically.
function getApiBaseUrl(): string {
  try {
    const url = execSync(
      "tofu -chdir=../tofu/phase4 output -raw api_base_url",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    console.log(`  API proxy target: ${url}`);
    return url;
  } catch {
    console.warn(
      "  Warning: Could not read API base URL from tofu output.\n" +
        "  Make sure Phase 4 is provisioned. Using fallback."
    );
    return "http://localhost:4566/restapis/UNKNOWN/dev/_user_request_";
  }
}

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
    },
  },
});
