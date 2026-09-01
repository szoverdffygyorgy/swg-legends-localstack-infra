# Project Context: SWG Legends Crafting & Resource Intelligence

## Purpose

A local AWS infrastructure learning project. The user is a software engineer who learned AWS services hands-on by building a real tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends MMORPG server.

All AWS services run locally via **LocalStack** (Docker). Zero cloud costs. The SWG theme provides real data and real use cases to make the learning concrete.

## Current Status

All modules complete. The system is fully operational.

- **Foundation** -- COMPLETE
- **Storage (S3 + DynamoDB)** -- COMPLETE
- **Messaging (SQS + SNS)** -- COMPLETE
- **Compute (Lambda)** -- COMPLETE
- **API (API Gateway)** -- COMPLETE
- **Orchestration (Step Functions)** -- COMPLETE
- **Monitoring (EventBridge + CloudWatch)** -- COMPLETE
- **React Frontend** -- COMPLETE (Vite + React 19 + React Router 7)

## Key Conventions

| Convention | Detail |
|------------|--------|
| IaC tool | **OpenTofu** (NOT Terraform). Commands use `tofu`, not `terraform`. |
| Language | TypeScript (backend + Lambda + frontend) |
| AWS emulation | LocalStack at `http://localhost:4566` |
| AWS region | `us-east-1` (arbitrary, LocalStack doesn't care) |
| AWS credentials | Dummy values (`test` / `test`) -- LocalStack ignores them but SDK requires them |
| Package manager | npm |
| Docker | `docker compose` (v2 syntax, no hyphen) |
| OpenTofu state | Per-module directories under `tofu/` (each module has its own state) |
| Data source | swgaide.com XML exports, SWG Legends server ID 138 |
| LocalStack auth | Requires `LOCALSTACK_AUTH_TOKEN` in `.env` (free Hobby tier) |
| Corporate proxy | Ion Group HTTPS interception; combined CA bundle mounted in Docker |
| Frontend | React 19 + Vite 6 + React Router 7, in `frontend/` directory (separate npm project) |
| Frontend theme | SWG NGE in-game UI palette: dark navy, pale blue text, warm gold accents |
| Lambda build | esbuild bundle → zip → deploy via `npm run lambda:build` (12 functions total) |

## Quick Start from Scratch

After `npm run localstack:reset` or a fresh clone:

```bash
# 1. Start LocalStack
npm run localstack:up

# 2. Provision all infrastructure (order matters -- modules reference each other's resources)
tofu -chdir=tofu/storage init && tofu -chdir=tofu/storage apply -auto-approve
tofu -chdir=tofu/messaging init && tofu -chdir=tofu/messaging apply -auto-approve
tofu -chdir=tofu/compute init && tofu -chdir=tofu/compute apply -auto-approve
tofu -chdir=tofu/api init && tofu -chdir=tofu/api apply -auto-approve
tofu -chdir=tofu/orchestration init && tofu -chdir=tofu/orchestration apply -auto-approve
tofu -chdir=tofu/monitoring init && tofu -chdir=tofu/monitoring apply -auto-approve
tofu -chdir=tofu/frontend init && tofu -chdir=tofu/frontend apply -auto-approve

# 3. Build and deploy all 12 Lambda functions
npm run lambda:build

# 4. Ingest data (first run = full load, subsequent = diff-based)
npm run ingest

# 5. Add alert rules
npm run alerts:add -- --name "Good Copper" --class Copper --stat oq --min 800
npm run alerts:add -- --name "Any Reactive Gas" --class "Reactive Gas"

# 6. Verify API
npm run api:test

# 7. Start frontend
npm run frontend:dev       # Dev server at http://localhost:3000
# OR
npm run frontend:deploy    # Build + upload to S3 static hosting
```

## Project Structure

```
swg-legends-localstack-infra/
  docker-compose.yml          # LocalStack container (with corporate proxy CA workaround)
  package.json                # Backend TypeScript project, AWS SDK v3, npm scripts
  tsconfig.json               # Backend TypeScript compiler config
  CHEATSHEET.md               # Copy-paste command reference
  .gitignore
  .env                        # LocalStack auth token (gitignored)
  .env.example                # Template for .env
  certs/                      # Corporate proxy CA bundle (gitignored)
  plan/
    handoff.md                # Full project backstory, decisions, module outcomes
    agents.md                 # This file -- AI agent context
  tofu/
    main.tf                   # Root provider config (Foundation)
    variables.tf              # Shared variables
    storage/                  # S3 bucket + DynamoDB tables (resources, resource-history)
    messaging/                # SNS topics + SQS queues + DynamoDB tables (event-log, alert-rules)
    compute/                  # Lambda functions (alert-evaluator, history-recorder) + IAM + SQS event sources
    api/                      # API Gateway REST API (7 endpoints) + 3 API Lambdas + IAM
    orchestration/            # Step Functions state machine + 7 pipeline Lambdas + IAM
    monitoring/               # EventBridge rules + CloudWatch dashboard/alarm + SNS topic
    frontend/                 # S3 bucket + website hosting config
  frontend/                   # React frontend (separate npm project)
    package.json              # Vite + React + TypeScript
    tsconfig.json             # Frontend TypeScript config
    vite.config.ts            # Dev server + API proxy to LocalStack
    index.html                # Vite entry point
    src/
      main.tsx                # React root mount
      App.tsx                 # Routes: /resources, /events, /alerts
      api/
        client.ts             # Typed fetch wrapper for all API endpoints
        types.ts              # Response types matching Lambda output
      pages/
        Resources.tsx         # Resource table with filters + sorting
        Events.tsx            # Event feed with date picker + type filter
        Alerts.tsx            # Alert rules CRUD + fired alert history
      components/
        Layout.tsx            # Header, nav tabs, content area, footer
        StatusBadge.tsx       # Colored status pill
        LoadingSpinner.tsx    # Loading state
        ErrorMessage.tsx      # Error display with retry button
      styles/
        theme.css             # SWG NGE color palette (CSS custom properties)
  src/
    config.ts                 # Shared AWS client factories + constants
    types.ts                  # SWGResource, ResourceItem, DiffResult, EventLogItem types
    verify-localstack.ts      # Foundation smoke test
    ingest/
      download.ts             # Download + decompress SWGAide XML export
      parse-resources.ts      # Parse XML -> SWGResource[]
      diff.ts                 # Compare XML against DynamoDB, produce spawn/despawn lists
      load-resources.ts       # Full load + incremental add/remove for DynamoDB
      log-events.ts           # Write spawn/despawn events to event-log table
      upload-to-s3.ts         # Archive raw XML to S3
      pipeline.ts             # Orchestrate full ingestion flow (direct/local version)
    messaging/
      publish-events.ts       # Publish spawn/despawn events to SNS topics
      process-history.ts      # SQS consumer: despawn events -> resource-history table
      process-alerts.ts       # SQS consumer: spawn events -> check alert rules -> fire alerts
    alerts/
      add-rule.ts             # Add a new alert rule
      list-rules.ts           # List all alert rules
      remove-rule.ts          # Remove an alert rule by ID
      history.ts              # View fired alert history
    query/
      find-resources.ts       # Query by planet/class/stat with CLI args
      event-log.ts            # Query spawn/despawn events by date
    export/
      generate-dashboard.ts   # Generate Bazaar Terminal HTML dashboard
      generate-ops-dashboard.ts # Generate operations HTML dashboard
    lambda/
      alert-evaluator/        # Compute: evaluate spawns against alert rules (SQS-triggered)
      history-recorder/       # Compute: record despawns to history table (SQS-triggered)
      api-get-resources/      # API: GET /resources, GET /resources/{id}
      api-get-events/         # API: GET /events
      api-alerts/             # API: /alerts/rules CRUD + /alerts/history
      pipeline-download/      # Orchestration: download SWGAide XML, upload to S3
      pipeline-parse/         # Orchestration: parse XML, write JSON to S3
      pipeline-diff/          # Orchestration: diff parsed data against DynamoDB
      pipeline-update-db/     # Orchestration: add spawned / remove despawned
      pipeline-log-events/    # Orchestration: write events to event-log table
      pipeline-publish-sns/   # Orchestration: publish spawn/despawn to SNS
      pipeline-archive/       # Orchestration: archive XML to permanent S3 path
    api/
      test-api.ts             # Smoke test for all 15 API endpoint tests
    pipeline/
      start.ts                # Start a Step Functions pipeline execution
      status.ts               # Check pipeline execution status
  scripts/
    build-lambdas.ts          # esbuild bundle + zip + deploy all 12 Lambdas to LocalStack
    deploy-frontend.ts        # Build React app + upload to S3 static hosting
  data/                       # Downloaded XML + generated dashboards (gitignored)
  dist/lambda/                # Built Lambda zip files (gitignored)
```

## Key npm Scripts

### Infrastructure
| Script | What it does |
|--------|-------------|
| `npm run localstack:up` | Start LocalStack container |
| `npm run localstack:reset` | Wipe all data and restart fresh |
| `npm run lambda:build` | Build + bundle + deploy all 12 Lambda functions |

### Data & Pipeline
| Script | What it does |
|--------|-------------|
| `npm run ingest` | Direct pipeline: download -> diff -> DynamoDB -> events -> SNS -> S3 |
| `npm run diff` | Show spawn/despawn diff without modifying anything |
| `npm run pipeline:start` | Start a Step Functions pipeline execution |
| `npm run pipeline:status` | Check pipeline execution status (last 5 runs) |

### Querying
| Script | What it does |
|--------|-------------|
| `npm run query -- --planet Tatooine` | Query resources by planet/class/stat |
| `npm run events` | Show today's spawn/despawn events |
| `npm run api:test` | Smoke test all 15 API Gateway endpoints |

### Alerts
| Script | What it does |
|--------|-------------|
| `npm run alerts:add -- --name X --class Y` | Add an alert rule |
| `npm run alerts:list` | Show all alert rules |
| `npm run alerts:remove -- --id r_xxx` | Remove an alert rule |
| `npm run alerts:history` | Show fired alert history |

### Dashboards & Frontend
| Script | What it does |
|--------|-------------|
| `npm run dashboard` | Generate Bazaar Terminal HTML dashboard |
| `npm run dashboard:ops` | Generate operations HTML dashboard |
| `npm run frontend:dev` | Start React dev server (http://localhost:3000) with API proxy |
| `npm run frontend:build` | Build React app for production |
| `npm run frontend:deploy` | Build + upload React app to S3 static hosting |

## User Context

- Semi-active SWG Legends player
- Also plays EVE Online and World of Tanks -- may build similar projects for those later
- Now has hands-on experience with all major AWS services in this project
- Comfortable with TypeScript, React, AWS SDK v3, OpenTofu, Docker Compose
- Understands the "why" behind each service and when to use what
- Prefers learning the widely-used, general-purpose tools first; niche things later
- Asks good questions about architecture tradeoffs -- explain reasoning, not just instructions

## Possible Extensions

- **Schematics data** -- Parse SWGAide's `schematics_unity.xml.gz`, add `GET /schematics/{name}/best-resources` API endpoint. Requires resource class hierarchy first.
- **Resource class hierarchy** -- Static TypeScript mapping of SWG's class tree. Would make alert matching smarter.
- **Frontend improvements** -- Resource detail view, real-time pipeline status, WebSocket live events, dark/light theme toggle.
- **Cognito (authentication)** -- User auth for per-user alert rules.
- **Deploy to real AWS** -- OpenTofu definitions are production-correct. Deploying to a real account would make CloudWatch, EventBridge, and IAM fully functional.
- **CI/CD pipeline** -- GitHub Actions for `tofu plan`, `lambda:build`, `api:test`, `frontend:deploy`.

## Known LocalStack Limitations

- **API Gateway v2 (HTTP API)** requires a paid LocalStack license. The API module uses REST API v1 (`aws_api_gateway_*`), which is available on the free Hobby tier.
- **MOCK integration responses** (for OPTIONS/CORS preflight) fail on LocalStack. CORS is handled by Lambda response headers instead (`Access-Control-Allow-Origin: *` on every response).
- **Lambda containers behind corporate proxy** can't reach external HTTPS URLs due to self-signed cert interception. The `pipeline-download` Lambda uses `NODE_TLS_REJECT_UNAUTHORIZED=0` as a LocalStack-only workaround.
- **Step Functions Parallel state** output replaces the state data with an array. Use `ResultPath` to merge parallel output into existing state data, preserving fields needed by later steps.
- **CloudWatch metrics** may not be populated by LocalStack services. Dashboard and alarm definitions are production-correct but may show no data locally.
- **EventBridge scheduled rules** may not fire reliably in LocalStack. The rules are created and can be verified, but automatic triggering may not work.

## Full Details

See `plan/handoff.md` for the complete backstory, all decisions made, data source details, module-by-module outcomes, and possible extensions.
