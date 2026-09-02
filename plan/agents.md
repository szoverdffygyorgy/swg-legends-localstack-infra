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
- **Classification (Resource Class Hierarchy)** -- COMPLETE (816-node tree, DynamoDB table, backfilled)
- **React Frontend** -- COMPLETE (Vite + React 19 + React Router 7, 4 pages)

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
| Lambda build | esbuild bundle -> zip -> deploy via `npm run lambda:build` (15 functions total) |
| Resource classification | 816-node class tree scraped from SWGAide, stored in DynamoDB + static JSON in S3 |
| Alert matching | Hierarchy-aware class matching, `statThresholds` map (AND), `planets` array (OR) |

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
tofu -chdir=tofu/classification init && tofu -chdir=tofu/classification apply -auto-approve
tofu -chdir=tofu/frontend init && tofu -chdir=tofu/frontend apply -auto-approve

# 3. Seed the resource class hierarchy (816 nodes -> DynamoDB)
npm run seed:classes

# 4. Build and deploy all 15 Lambda functions
npm run lambda:build

# 5. Ingest data (first run = full load, subsequent = diff-based)
#    Ingestion enriches resources with classPath, classCategory, classGroup
npm run ingest

# 6. Upload class tree JSON to S3 (frontend loads it at runtime)
#    The deploy-frontend script handles this automatically
npm run frontend:deploy

# 7. Add alert rules (hierarchy-aware, multi-threshold)
npm run alerts:add -- --name "Endgame Metal" --class Metal --stat oq:800 --stat sr:400 --planet Tatooine
npm run alerts:add -- --name "Any Reactive Gas" --class "Reactive Gas"

# 8. Verify API
npm run api:test

# 9. Start frontend
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
    storage/                  # S3 bucket + DynamoDB tables (resources w/ by-category GSI, resource-history)
    messaging/                # SNS topics + SQS queues + DynamoDB tables (event-log, alert-rules)
    compute/                  # Lambda functions (alert-evaluator, history-recorder) + IAM + SQS event sources
    api/                      # API Gateway REST API (9 endpoints) + 5 API Lambdas + IAM
    orchestration/            # Step Functions state machine + 7 pipeline Lambdas + IAM
    monitoring/               # EventBridge rules + CloudWatch dashboard/alarm + SNS topic
    classification/           # DynamoDB table (resource-classes, 816 nodes) + GSIs (by-parent, by-path)
    frontend/                 # S3 bucket + website hosting config
  frontend/                   # React frontend (separate npm project)
    package.json              # Vite + React + TypeScript
    tsconfig.json             # Frontend TypeScript config
    vite.config.ts            # Dev server + API proxy to LocalStack
    index.html                # Vite entry point
    src/
      main.tsx                # React root mount
      App.tsx                 # Routes: /resources, /events, /alerts, /ops (/pipeline redirects to /ops)
      api/
        client.ts             # Typed fetch wrapper for all API endpoints
        types.ts              # Response types matching Lambda output
      pages/
        Resources.tsx + .css  # Resource table with class tree sidebar, stat quality %, alert dropdown
        Events.tsx + .css     # Event feed with date picker + type filter
        Alerts.tsx + .css     # Alert rules CRUD (multi-threshold form with typeahead) + fired history
        Ops.tsx + .css        # System health bar, pipeline history, Lambda metrics, SQS queues, log viewer
      components/
        Layout.tsx + .css     # Header, nav tabs (Resources/Events/Alerts/Ops), sync indicator, footer
        ClassTreePicker.tsx + .css  # Expandable resource class hierarchy picker for filtering
        StatusBadge.tsx + .css      # Colored status pill
        LoadingSpinner.tsx + .css   # Loading state
        ErrorMessage.tsx + .css     # Error display with retry button
      styles/
        theme.css             # SWG NGE color palette (CSS custom properties)
  src/
    config.ts                 # Shared AWS client factories + constants
    types.ts                  # SWGResource, ResourceItem, DiffResult, EventLogItem, ResourceClassNode types
    verify-localstack.ts      # Foundation smoke test
    data/
      resource-class-tree.json  # Static 816-node class hierarchy (served from S3 at runtime)
    ingest/
      download.ts             # Download + decompress SWGAide XML export
      parse-resources.ts      # Parse XML -> SWGResource[]
      diff.ts                 # Compare XML against DynamoDB, produce spawn/despawn lists
      load-resources.ts       # Full load + incremental add/remove for DynamoDB (enriches with classification)
      log-events.ts           # Write spawn/despawn events to event-log table
      upload-to-s3.ts         # Archive raw XML to S3
      pipeline.ts             # Orchestrate full ingestion flow (direct/local version)
    messaging/
      publish-events.ts       # Publish spawn/despawn events to SNS topics
      process-history.ts      # SQS consumer: despawn events -> resource-history table
      process-alerts.ts       # SQS consumer: spawn events -> hierarchy-aware alert matching -> fire alerts
    alerts/
      add-rule.ts             # Add alert rule (--stat oq:800 --stat sr:400 --planet Tatooine)
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
      alert-evaluator/        # Compute: evaluate spawns against alert rules (SQS-triggered, hierarchy-aware)
      history-recorder/       # Compute: record despawns to history table (SQS-triggered)
      api-get-resources/      # API: GET /resources, GET /resources/{id}
      api-get-events/         # API: GET /events
      api-alerts/             # API: /alerts/rules CRUD + /alerts/history
      api-pipeline-status/    # API: GET /pipeline/status (last sync metadata + execution history)
      api-ops-dashboard/      # API: GET /ops/dashboard (aggregates DynamoDB, SFN, CloudWatch, SQS)
      pipeline-download/      # Orchestration: download SWGAide XML, upload to S3
      pipeline-parse/         # Orchestration: parse XML, write JSON to S3
      pipeline-diff/          # Orchestration: diff parsed data against DynamoDB
      pipeline-update-db/     # Orchestration: add spawned / remove despawned (with classification enrichment)
      pipeline-log-events/    # Orchestration: write events to event-log table
      pipeline-publish-sns/   # Orchestration: publish spawn/despawn to SNS
      pipeline-archive/       # Orchestration: archive XML to permanent S3 path + write lastSync to event-log
    api/
      test-api.ts             # Smoke test: 15 test cases across 9 API endpoints
    pipeline/
      start.ts                # Start a Step Functions pipeline execution
      status.ts               # Check pipeline execution status
  scripts/
    build-lambdas.ts          # esbuild bundle + zip + deploy all 15 Lambdas to LocalStack
    deploy-frontend.ts        # Build React app + upload to S3 static hosting
    scrape-resource-tree.ts   # Scrape SWGAide for 816-node resource class hierarchy -> JSON
    seed-resource-classes.ts  # Load resource-class-tree.json into resource-classes DynamoDB table
    backfill-resource-classes.ts  # Backfill classPath/classCategory/classGroup on existing resource items
  data/                       # Downloaded XML + generated dashboards (gitignored)
  dist/lambda/                # Built Lambda zip files (gitignored)
```

## AWS Resources Summary

| Service | Count | Details |
|---------|-------|---------|
| DynamoDB tables | 5 | resources (by-planet + by-category GSIs), resource-history, event-log, alert-rules, resource-classes (by-parent + by-path GSIs) |
| Lambda functions | 15 | 2 compute (SQS-triggered), 5 API (Gateway-triggered), 7 pipeline (Step Functions), 1 archive |
| S3 buckets | 2 | swg-legends-data (XML archives + class tree JSON), swg-legends-frontend (static hosting) |
| SQS queues | 2 | spawn-events, despawn-events |
| SNS topics | 2 | resource-spawned, resource-despawned |
| API Gateway | 1 REST API | 9 endpoints: GET /resources, GET /resources/{id}, GET /events, GET /alerts/rules, POST /alerts/rules, DELETE /alerts/rules/{ruleId}, GET /alerts/history, GET /pipeline/status, GET /ops/dashboard |
| Step Functions | 1 state machine | 7-step ingestion pipeline |
| EventBridge | 1 scheduled rule | Periodic pipeline trigger |
| CloudWatch | 1 dashboard + 1 alarm | Monitoring (limited in LocalStack free tier) |
| OpenTofu modules | 8 | storage, messaging, compute, api, orchestration, monitoring, classification, frontend |

## Key npm Scripts

### Infrastructure
| Script | What it does |
|--------|-------------|
| `npm run localstack:up` | Start LocalStack container |
| `npm run localstack:reset` | Wipe all data and restart fresh |
| `npm run lambda:build` | Build + bundle + deploy all 15 Lambda functions |

### Classification
| Script | What it does |
|--------|-------------|
| `npm run scrape:tree` | Scrape SWGAide for 816-node resource class hierarchy -> JSON |
| `npm run seed:classes` | Load resource-class-tree.json into resource-classes DynamoDB table |
| `npm run backfill:classes` | Backfill classPath/classCategory/classGroup on existing resource items |

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
| `npm run api:test` | Smoke test: 15 test cases across 9 API endpoints |

### Alerts
| Script | What it does |
|--------|-------------|
| `npm run alerts:add -- --name X --class Y --stat oq:800 --planet Tatooine` | Add alert rule (multi-threshold, multi-planet) |
| `npm run alerts:list` | Show all alert rules |
| `npm run alerts:remove -- --id r_xxx` | Remove an alert rule |
| `npm run alerts:history` | Show fired alert history |

### OpenTofu (per-module)
| Script | What it does |
|--------|-------------|
| `npm run tofu:init:<module>` | Initialize module (storage, messaging, compute, api, orchestration, monitoring, classification) |
| `npm run tofu:plan:<module>` | Show planned changes |
| `npm run tofu:apply:<module>` | Apply changes |
| `npm run tofu:destroy:<module>` | Destroy module resources |

### Dashboards & Frontend
| Script | What it does |
|--------|-------------|
| `npm run dashboard` | Generate Bazaar Terminal HTML dashboard |
| `npm run dashboard:ops` | Generate operations HTML dashboard |
| `npm run frontend:dev` | Start React dev server (http://localhost:3000) with API proxy |
| `npm run frontend:build` | Build React app for production |
| `npm run frontend:deploy` | Build + upload React app to S3 static hosting |

## Alert System

Alert rules support:
- **classPattern** -- hierarchy-aware matching. "Metal" matches all metals (Copper, Iron, Steel, etc.) by walking the class tree.
- **statThresholds** -- map of stat:minimum pairs. All must be met (AND logic). Example: `{ oq: 800, sr: 400 }`.
- **planets** -- array of planet names. Resource must spawn on at least one (OR logic). Example: `["Tatooine", "Naboo"]`.

CLI example:
```bash
npm run alerts:add -- --name "Endgame Metal" --class Metal --stat oq:800 --stat sr:400 --planet Tatooine
```

Ingestion validates resources against the class hierarchy and warns on unknown classes.

## User Context

- Semi-active SWG Legends player
- Also plays EVE Online and World of Tanks -- may build similar projects for those later
- Now has hands-on experience with all major AWS services in this project
- Comfortable with TypeScript, React, AWS SDK v3, OpenTofu, Docker Compose
- Understands the "why" behind each service and when to use what
- Prefers learning the widely-used, general-purpose tools first; niche things later
- Asks good questions about architecture tradeoffs -- explain reasoning, not just instructions

## Possible Extensions

- **Schematics data** -- Parse SWGAide's `schematics_unity.xml.gz`, add `GET /schematics/{name}/best-resources` API endpoint. Now possible since resource class hierarchy is built.
- **Ops endpoint caching / separation** -- The `/ops/dashboard` Lambda aggregates multiple AWS API calls (DynamoDB, SFN, CloudWatch, SQS). Could benefit from response caching or splitting into separate endpoints for parallel frontend fetches.
- **CI/CD pipeline** -- GitHub Actions for `tofu plan`, `lambda:build`, `api:test`, `frontend:deploy`.
- **Deploy to real AWS** -- OpenTofu definitions are production-correct. Deploying to a real account would make CloudWatch, EventBridge, and IAM fully functional.
- **Cognito (authentication)** -- User auth for per-user alert rules.
- **Frontend improvements** -- Resource detail view, WebSocket live events, dark/light theme toggle.

## Known LocalStack Limitations

- **API Gateway v2 (HTTP API)** requires a paid LocalStack license. The API module uses REST API v1 (`aws_api_gateway_*`), which is available on the free Hobby tier.
- **MOCK integration responses** (for OPTIONS/CORS preflight) fail on LocalStack. CORS is handled by Lambda response headers instead (`Access-Control-Allow-Origin: *` on every response).
- **Lambda containers behind corporate proxy** can't reach external HTTPS URLs due to self-signed cert interception. The `pipeline-download` Lambda uses `NODE_TLS_REJECT_UNAUTHORIZED=0` as a LocalStack-only workaround.
- **Step Functions Parallel state** output replaces the state data with an array. Use `ResultPath` to merge parallel output into existing state data, preserving fields needed by later steps.
- **CloudWatch metrics** may not be populated by LocalStack services. Dashboard and alarm definitions are production-correct but may show no data locally. The Ops page's CloudWatch-dependent panels (Lambda metrics, log viewer) may show empty data in LocalStack.
- **EventBridge scheduled rules** may not fire reliably in LocalStack. The rules are created and can be verified, but automatic triggering may not work.

## Full Details

See `plan/handoff.md` for the complete backstory, all decisions made, data source details, module-by-module outcomes, and possible extensions.
