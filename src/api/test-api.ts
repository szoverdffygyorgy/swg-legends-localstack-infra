/**
 * API smoke test — verify all API endpoints are working.
 *
 * This script hits every endpoint and reports pass/fail results.
 * It also serves as documentation of the API: every endpoint,
 * its parameters, and expected behavior are demonstrated here.
 *
 * Prerequisites:
 *   1. LocalStack running (npm run localstack:up)
 *   2. Storage, messaging, compute, and API modules provisioned (tofu apply)
 *   3. Data ingested (npm run ingest)
 *   4. Lambdas built and deployed (npm run lambda:build)
 *
 * Usage:
 *   npm run api:test
 *
 * The script reads the API ID from `tofu output` automatically.
 */

import { execSync } from "node:child_process";
import { apiBaseUrl } from "../config.js";

// ─── Colors ──────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ─── Get API ID from OpenTofu output ─────────────────────────────────

function getApiId(): string {
  // Try environment variable first (for CI or manual override)
  if (process.env.API_ID) {
    return process.env.API_ID;
  }

  try {
    const output = execSync("tofu -chdir=tofu/api output -raw api_id", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output;
  } catch {
    console.error(
      `${RED}Failed to read API ID from tofu output.${RESET}\n` +
      `Make sure API module infrastructure is provisioned:\n` +
      `  npm run tofu:init:api\n` +
      `  npm run tofu:apply:api\n` +
      `\nOr set API_ID environment variable manually.\n`
    );
    process.exit(1);
  }
}

// ─── Test runner ─────────────────────────────────────────────────────

interface TestResult {
  name: string;
  method: string;
  path: string;
  status: number;
  passed: boolean;
  detail?: string;
}

async function testEndpoint(
  baseUrl: string,
  name: string,
  method: string,
  path: string,
  options?: {
    expectedStatus?: number;
    body?: unknown;
    validate?: (body: unknown) => string | null; // return error message or null
  }
): Promise<TestResult> {
  const url = `${baseUrl}${path}`;
  const expectedStatus = options?.expectedStatus ?? 200;

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const responseBody = await response.json();

    let passed = response.status === expectedStatus;
    let detail: string | undefined;

    if (passed && options?.validate) {
      const error = options.validate(responseBody);
      if (error) {
        passed = false;
        detail = error;
      }
    }

    if (!passed && !detail) {
      detail = `Expected status ${expectedStatus}, got ${response.status}`;
      if (response.status !== expectedStatus) {
        detail += ` — ${JSON.stringify(responseBody).slice(0, 100)}`;
      }
    }

    return { name, method, path, status: response.status, passed, detail };
  } catch (err) {
    return {
      name,
      method,
      path,
      status: 0,
      passed: false,
      detail: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiId = getApiId();
  const baseUrl = apiBaseUrl(apiId);

  console.log("=== SWG Legends API Smoke Tests ===\n");
  console.log(`  API ID:    ${apiId}`);
  console.log(`  Base URL:  ${DIM}${baseUrl}${RESET}\n`);

  const results: TestResult[] = [];

  // ── GET /resources (list all) ────────────────────────────────────
  results.push(
    await testEndpoint(baseUrl, "List all resources", "GET", "/resources", {
      validate: (body: unknown) => {
        const b = body as Record<string, unknown>;
        if (typeof b.count !== "number") return "Missing 'count' field";
        if (!Array.isArray(b.resources)) return "Missing 'resources' array";
        return null;
      },
    })
  );

  // ── GET /resources?planet=Tatooine ───────────────────────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Resources on Tatooine",
      "GET",
      "/resources?planet=Tatooine",
      {
        validate: (body: unknown) => {
          const b = body as Record<string, unknown>;
          if (typeof b.count !== "number") return "Missing 'count'";
          return null;
        },
      }
    )
  );

  // ── GET /resources?class=Copper ──────────────────────────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Copper resources",
      "GET",
      "/resources?class=Copper"
    )
  );

  // ── GET /resources?stat=oq&min=800 ──────────────────────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Resources with OQ >= 800",
      "GET",
      "/resources?stat=oq&min=800"
    )
  );

  // ── GET /resources?min=500 (invalid — min without stat) ──────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Invalid: min without stat",
      "GET",
      "/resources?min=500",
      { expectedStatus: 400 }
    )
  );

  // ── GET /resources/{id} (we'll use a fake ID for 404) ───────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Resource by ID (not found)",
      "GET",
      "/resources/9999999",
      { expectedStatus: 404 }
    )
  );

  // ── GET /events ──────────────────────────────────────────────────
  results.push(
    await testEndpoint(baseUrl, "Today's events", "GET", "/events", {
      validate: (body: unknown) => {
        const b = body as Record<string, unknown>;
        if (typeof b.date !== "string") return "Missing 'date'";
        if (!Array.isArray(b.events)) return "Missing 'events' array";
        return null;
      },
    })
  );

  // ── GET /events?type=SPAWNED ─────────────────────────────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Spawn events only",
      "GET",
      "/events?type=SPAWNED"
    )
  );

  // ── GET /events?date=invalid (bad date format) ──────────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Invalid date format",
      "GET",
      "/events?date=yesterday",
      { expectedStatus: 400 }
    )
  );

  // ── GET /alerts/rules ────────────────────────────────────────────
  results.push(
    await testEndpoint(baseUrl, "List alert rules", "GET", "/alerts/rules", {
      validate: (body: unknown) => {
        const b = body as Record<string, unknown>;
        if (typeof b.count !== "number") return "Missing 'count'";
        if (!Array.isArray(b.rules)) return "Missing 'rules' array";
        return null;
      },
    })
  );

  // ── POST /alerts/rules (create a test rule) ─────────────────────
  const testRuleName = `API Test Rule ${Date.now()}`;
  let testRuleId: string | undefined;

  results.push(
    await testEndpoint(
      baseUrl,
      "Create alert rule",
      "POST",
      "/alerts/rules",
      {
        expectedStatus: 201,
        body: {
          name: testRuleName,
          classPattern: "TestClass",
          stat: "oq",
          minValue: 999,
        },
        validate: (body: unknown) => {
          const b = body as Record<string, unknown>;
          const rule = b.rule as Record<string, unknown> | undefined;
          if (!rule?.ruleId) return "Missing rule.ruleId in response";
          testRuleId = rule.ruleId as string;
          return null;
        },
      }
    )
  );

  // ── POST /alerts/rules (invalid — missing fields) ───────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Create rule (missing fields)",
      "POST",
      "/alerts/rules",
      {
        expectedStatus: 400,
        body: { name: "Incomplete" },
      }
    )
  );

  // ── DELETE /alerts/rules/{ruleId} (clean up test rule) ──────────
  if (testRuleId) {
    results.push(
      await testEndpoint(
        baseUrl,
        "Delete alert rule",
        "DELETE",
        `/alerts/rules/${testRuleId}`
      )
    );
  }

  // ── DELETE /alerts/rules/{ruleId} (not found) ───────────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Delete rule (not found)",
      "DELETE",
      "/alerts/rules/r_nonexistent",
      { expectedStatus: 404 }
    )
  );

  // ── GET /alerts/history ──────────────────────────────────────────
  results.push(
    await testEndpoint(
      baseUrl,
      "Fired alert history",
      "GET",
      "/alerts/history",
      {
        validate: (body: unknown) => {
          const b = body as Record<string, unknown>;
          if (typeof b.count !== "number") return "Missing 'count'";
          if (!Array.isArray(b.alerts)) return "Missing 'alerts' array";
          return null;
        },
      }
    )
  );

  // ── Print results ────────────────────────────────────────────────
  console.log("─".repeat(70));
  console.log("");

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    const method = r.method.padEnd(6);
    console.log(`  ${icon}  ${method} ${r.path}`);
    console.log(`         ${DIM}${r.name}${RESET}`);
    if (r.detail) {
      console.log(`         ${RED}${r.detail}${RESET}`);
    }
    if (r.passed) passed++;
    else failed++;
  }

  console.log("");
  console.log("─".repeat(70));
  console.log(
    `\n  ${GREEN}${passed} passed${RESET}` +
    (failed > 0 ? `, ${RED}${failed} failed${RESET}` : "") +
    ` out of ${results.length} tests\n`
  );

  if (failed > 0) {
    console.log(
      `${YELLOW}Some tests failed. Check that:${RESET}\n` +
      `  1. LocalStack is running (npm run localstack:up)\n` +
      `  2. All phases are provisioned (tofu apply)\n` +
      `  3. Data is ingested (npm run ingest)\n` +
      `  4. Lambdas are deployed (npm run lambda:build)\n`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
