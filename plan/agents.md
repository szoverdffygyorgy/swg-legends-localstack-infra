# Project Context: SWG Legends Crafting & Resource Intelligence

## Purpose

A local AWS infrastructure learning project. The user is a software engineer who learned AWS services hands-on by building a real tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends MMORPG server.

All AWS services run locally via **LocalStack** (Docker). Zero cloud costs. The SWG theme provides real data and real use cases to make the learning concrete.

## Current Status

All modules complete, plus schematics pipeline. The system is fully operational.

- **Foundation** -- COMPLETE
- **Storage (S3 + DynamoDB)** -- COMPLETE
- **Messaging (SQS + SNS)** -- COMPLETE
- **Compute (Lambda)** -- COMPLETE
- **API (API Gateway)** -- COMPLETE
- **Orchestration (Step Functions)** -- COMPLETE
- **Monitoring (EventBridge + CloudWatch)** -- COMPLETE
- **Classification (Resource Class Hierarchy)** -- COMPLETE (816-node tree, DynamoDB table, backfilled)
- **Schematics** -- COMPLETE (3,673 schematics, DynamoDB single-table, API endpoints, Resource Profile integration)
- **React Frontend** -- COMPLETE (Vite + React 19 + React Router 7 + TanStack Query, 6 pages)

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
| Frontend | React 19 + Vite 6 + React Router 7 + TanStack Query, in `frontend/` directory (separate npm project) |
| Frontend theme | SWG NGE in-game UI palette: dark navy, pale blue text, warm gold accents |
| Lambda build | esbuild bundle -> zip -> deploy via `npm run lambda:build` (17 functions total) |
| Resource classification | 816-node class tree scraped from SWGAide, stored in DynamoDB + static JSON in S3 |
| Alert matching | Hierarchy-aware class matching, `statThresholds` map (AND), `planets` array (OR) |
| Schematics | 3,673 schematics from SWGAide, stored in DynamoDB (single-table: SCHEM# metadata + CLASS# ingredient index) |
| SWGAide class mapping | 815-entry abbreviation -> className mapping in `src/data/swgaide-class-map.json` |

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
tofu -chdir=tofu/schematics init && tofu -chdir=tofu/schematics apply -auto-approve
tofu -chdir=tofu/frontend init && tofu -chdir=tofu/frontend apply -auto-approve

# 3. Seed the resource class hierarchy (816 nodes -> DynamoDB)
npm run seed:classes

# 4. Seed schematics data (3,673 schematics + ingredient index -> DynamoDB)
npm run schematics:seed

# 5. Build and deploy all 17 Lambda functions
npm run lambda:build

# 5. Build and deploy all 17 Lambda functions
npm run lambda:build

# 6. Ingest data (first run = full load, subsequent = diff-based)
#    Ingestion enriches resources with classPath, classCategory, classGroup
npm run ingest

# 7. Upload class tree JSON to S3 (frontend loads it at runtime)
#    The deploy-frontend script handles this automatically
npm run frontend:deploy

# 8. Backfill history items with classification data (if history table has existing data)
npm run backfill:history

# 9. Add alert rules (hierarchy-aware, multi-threshold)
npm run alerts:add -- --name "Endgame Metal" --class Metal --stat oq:800 --stat sr:400 --planet Tatooine
npm run alerts:add -- --name "Any Reactive Gas" --class "Reactive Gas"

# 10. Verify API
npm run api:test

# 11. Start frontend
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
    storage/                  # S3 bucket + DynamoDB tables (resources w/ by-category GSI, resource-history w/ by-category GSI)
    messaging/                # SNS topics + SQS queues + DynamoDB tables (event-log, alert-rules)
    compute/                  # Lambda functions (alert-evaluator, history-recorder) + IAM + SQS event sources
    api/                      # API Gateway REST API (14 endpoints) + 7 API Lambdas + IAM
    orchestration/            # Step Functions state machine + 7 pipeline Lambdas + IAM
    monitoring/               # EventBridge rules + CloudWatch dashboard/alarm + SNS topic
    classification/           # DynamoDB table (resource-classes, 816 nodes) + GSIs (by-parent, by-path)
    schematics/               # DynamoDB table (schematics, single-table: SCHEM# + CLASS#) + by-category GSI
    frontend/                 # S3 bucket + website hosting config
  frontend/                   # React frontend (separate npm project)
    package.json              # Vite + React + TypeScript + TanStack Query
    tsconfig.json             # Frontend TypeScript config
    vite.config.ts            # Dev server + API proxy to LocalStack
    index.html                # Vite entry point
    src/
      main.tsx                # React root mount + QueryClientProvider
      App.tsx                 # Routes: /resources, /resources/:id, /history, /events, /alerts, /ops (/pipeline redirects to /ops)
      api/
        client.ts             # Typed fetch wrapper for all API endpoints
        types.ts              # Response types matching Lambda output
        queryClient.ts        # TanStack Query client configuration (retry, staleTime, gcTime)
        hooks.ts              # 16 custom hooks (12 queries + 3 mutations + query key factory)
      pages/
        Resources.tsx + .css  # Resource table with class tree sidebar, stat quality %, alert dropdown, clickable rows
        ResourceProfile.tsx + .css  # Resource detail page with StatBar, status badge, "Used In Schematics" section
        History.tsx + .css    # Past resources with class tree sidebar, alert presets, name search, filter-first UX
        Events.tsx + .css     # Event feed with date picker + type filter
        Alerts.tsx + .css     # Alert rules CRUD (multi-threshold form with typeahead) + enable/disable toggle + fired history
        Ops.tsx + .css        # System health bar, pipeline history, Lambda metrics, SQS queues, log viewer
      components/
        Layout.tsx + .css     # Header, nav tabs (Resources/History/Events/Alerts/Ops), sync indicator, footer
        ClassTreePicker.tsx + .css  # Expandable resource class hierarchy picker for filtering
        StatBar.tsx + .css    # Stat bar with 0-1000 scale, cap range highlight, value fill, raw-value color tiers
        StatusBadge.tsx + .css      # Colored status pill
        LoadingSpinner.tsx + .css   # Loading state
        ErrorMessage.tsx + .css     # Error display with retry button
      utils/
        stats.ts              # Shared stat quality helpers (statQuality, qualityClass, rawValueClass)
        alerts.ts             # Shared alert helpers (matching, formatting, planet extraction)
      styles/
        theme.css             # SWG NGE color palette (CSS custom properties)
  src/
    config.ts                 # Shared AWS client factories + constants
    types.ts                  # SWGResource, ResourceItem, DiffResult, EventLogItem, ResourceClassNode, Schematic types
    verify-localstack.ts      # Foundation smoke test
    data/
      resource-class-tree.json  # Static 816-node class hierarchy (served from S3 at runtime)
      swgaide-class-map.json    # 815-entry SWGAide abbreviation -> className mapping
    ingest/
      download.ts             # Download + decompress SWGAide XML export
      parse-resources.ts      # Parse XML -> SWGResource[]
      diff.ts                 # Compare XML against DynamoDB, produce spawn/despawn lists
      load-resources.ts       # Full load + incremental add/remove for DynamoDB (enriches with classification)
      log-events.ts           # Write spawn/despawn events to event-log table
      upload-to-s3.ts         # Archive raw XML to S3
      pipeline.ts             # Orchestrate full ingestion flow (direct/local version)
      download-schematics.ts  # Download + decompress SWGAide schematics XML
      parse-schematics.ts     # Parse schematics XML -> Schematic[] with resolved class names
      ingest-schematics.ts    # Dry-run pipeline: download + parse + validate + summary
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
      find-schematics.ts      # Query schematics by name/class/category/id
      event-log.ts            # Query spawn/despawn events by date
    export/
      generate-dashboard.ts   # Generate Bazaar Terminal HTML dashboard
      generate-ops-dashboard.ts # Generate operations HTML dashboard
    lambda/
      alert-evaluator/        # Compute: evaluate spawns against alert rules (SQS-triggered, hierarchy-aware)
      history-recorder/       # Compute: record despawns to history table (SQS-triggered, enriches with classification + flattened stats)
      api-get-resources/      # API: GET /resources, GET /resources/{id}
      api-get-events/         # API: GET /events
      api-get-history/        # API: GET /history, GET /history/{id}
      api-alerts/             # API: /alerts/rules CRUD + toggle + /alerts/history
      api-pipeline-status/    # API: GET /pipeline/status (last sync metadata + execution history)
      api-ops-dashboard/      # API: GET /ops/dashboard (aggregates DynamoDB, SFN, CloudWatch, SQS)
      api-get-schematics/     # API: GET /schematics, GET /schematics/{id} (hierarchy-aware ingredient index)
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
    build-lambdas.ts          # esbuild bundle + zip + deploy all 17 Lambdas to LocalStack
    deploy-frontend.ts        # Build React app + upload to S3 static hosting
    scrape-resource-tree.ts   # Scrape SWGAide for 816-node resource class hierarchy -> JSON
    seed-resource-classes.ts  # Load resource-class-tree.json into resource-classes DynamoDB table
    seed-schematics.ts        # Download + parse + batch write schematics to DynamoDB (12,997 items)
    backfill-resource-classes.ts  # Backfill classPath/classCategory/classGroup on existing resource items
    backfill-resource-history.ts  # Backfill classification + flattened stats on existing history items
  data/                       # Downloaded XML + generated dashboards (gitignored)
  dist/lambda/                # Built Lambda zip files (gitignored)
```

## AWS Resources Summary

| Service | Count | Details |
|---------|-------|---------|
| DynamoDB tables | 6 | resources (by-planet + by-category GSIs), resource-history (by-category GSI), event-log, alert-rules, resource-classes (by-parent + by-path GSIs), schematics (by-category GSI) |
| Lambda functions | 17 | 2 compute (SQS-triggered), 7 API (Gateway-triggered), 7 pipeline (Step Functions), 1 archive |
| S3 buckets | 2 | swg-legends-data (XML archives + class tree JSON), swg-legends-frontend (static hosting) |
| SQS queues | 2 | spawn-events, despawn-events |
| SNS topics | 2 | resource-spawned, resource-despawned |
| API Gateway | 1 REST API | 14 endpoints: GET /resources, GET /resources/{id}, GET /history, GET /history/{id}, GET /events, GET /alerts/rules, POST /alerts/rules, PUT /alerts/rules/{ruleId}, DELETE /alerts/rules/{ruleId}, GET /alerts/history, GET /pipeline/status, GET /ops/dashboard, GET /schematics, GET /schematics/{id} |
| Step Functions | 1 state machine | 7-step ingestion pipeline |
| EventBridge | 1 scheduled rule | Periodic pipeline trigger |
| CloudWatch | 1 dashboard + 1 alarm | Monitoring (limited in LocalStack free tier) |
| OpenTofu modules | 9 | storage, messaging, compute, api, orchestration, monitoring, classification, schematics, frontend |

## Key npm Scripts

### Infrastructure
| Script | What it does |
|--------|-------------|
| `npm run localstack:up` | Start LocalStack container |
| `npm run localstack:reset` | Wipe all data and restart fresh |
| `npm run lambda:build` | Build + bundle + deploy all 17 Lambda functions |

### Classification
| Script | What it does |
|--------|-------------|
| `npm run scrape:tree` | Scrape SWGAide for 816-node resource class hierarchy -> JSON |
| `npm run seed:classes` | Load resource-class-tree.json into resource-classes DynamoDB table |
| `npm run backfill:classes` | Backfill classPath/classCategory/classGroup on existing resource items |
| `npm run backfill:history` | Backfill classification + flattened stats on existing history items |

### Schematics
| Script | What it does |
|--------|-------------|
| `npm run schematics:download` | Download + decompress schematics XML from SWGAide |
| `npm run schematics:ingest` | Dry-run: download + parse + validate + print summary (no DB write) |
| `npm run schematics:seed` | Full pipeline: download + parse + batch write to DynamoDB (12,997 items) |
| `npm run schematics:query` | Query schematics by name/class/category/id |

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
| `npm run tofu:init:<module>` | Initialize module (storage, messaging, compute, api, orchestration, monitoring, classification, schematics) |
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
- Comfortable with TypeScript, React, TanStack Query, AWS SDK v3, OpenTofu, Docker Compose
- Understands the "why" behind each service and when to use what
- Prefers learning the widely-used, general-purpose tools first; niche things later
- Asks good questions about architecture tradeoffs -- explain reasoning, not just instructions

## Possible Extensions

### Tier 1: High Value + New Infra Learning

These teach new AWS concepts while delivering meaningful features.

| Item | New Infra Learned | Feature Value |
|------|-------------------|---------------|
| **DynamoDB TTL (Time-To-Live)** | DynamoDB lifecycle management, automatic item expiration | Keeps event-log and history from growing unbounded |
| **Resource notifications (SNS email)** | SNS email subscriptions, delivery mechanisms | Makes alerts actually *alert* you -- fired alerts trigger real emails |
| **Lambda layers** | Lambda code sharing pattern | Cleans up duplicated classification cache loading across 5+ Lambdas |

### Tier 2: High Feature Value, Familiar Infra

These use patterns already learned but deliver strong user-facing results.

| Item | Why |
|------|-----|
| **Schematic Profile page** | Dedicated `/schematics/{id}` page showing full recipe detail, ingredient breakdown, and best current/historical resources for each slot. API endpoint already exists. |
| **Best resource scoring endpoint** | `GET /schematics/{id}/best-resources` applies experimental stat weights to rank current resources per ingredient slot |
| **Crafting calculator page** | Select a schematic, see what active/historical resources would give the best results |
| **Resource comparison** | On the Resource Profile page, show how this resource ranks against other active/past resources of the same class |
| **Pagination** | Server-side pagination with DynamoDB cursor tokens (ExclusiveStartKey pattern) as data grows |

### Tier 3: New Infra Concepts, Less Feature Impact

Pure learning, less visible to a user but teaches important AWS patterns.

| Item | What You Learn |
|------|----------------|
| **DynamoDB Streams** | Alternative event-driven architecture -- react to table changes instead of publishing to SNS explicitly |
| **S3 lifecycle policies** | Storage cost management -- auto-transition old XML archives to Glacier or delete after N days |
| **API Gateway caching** | API-level performance optimization on frequently-hit read endpoints without code changes |
| **Cross-module OpenTofu state refs** | Production IaC patterns -- use `terraform_remote_state` or output references instead of hardcoded table names |
| **Multi-environment support** | dev/staging/prod variable sets in OpenTofu -- same infra definitions, different resource names per environment |
| **SQS FIFO queues** | Exactly-once vs at-least-once processing tradeoffs -- replace standard queues with FIFO |

### Tier 4: DevOps / Educational

Worth doing eventually, not urgent.

| Item | What You Learn |
|------|----------------|
| **CI/CD pipeline** | GitHub Actions to run `tofu plan`, `lambda:build`, `api:test`, `frontend:deploy` on push |
| **Deploy to real AWS** | Real cloud, real costs, real IAM -- OpenTofu definitions are production-correct |
| **Infrastructure testing** | Terratest or `tofu plan` validation to catch drift between actual and expected state |
| **WebSocket live events** | Real-time push for spawn/despawn events (may require paid LocalStack for API Gateway v2) |
| **Dark/light theme toggle** | Pure frontend -- CSS custom properties are already in place, just needs a second value set + toggle |
| **CSV/JSON export** | Download filtered resource lists or history data for external analysis |
| **Unified search** | Cross-table search checking both active resources and history simultaneously |
| **CloudFormation or CDK rewrite** | Rewrite the IaC in AWS-native tooling for comparison with OpenTofu |

## Known LocalStack Limitations

- **API Gateway v2 (HTTP API)** requires a paid LocalStack license. The API module uses REST API v1 (`aws_api_gateway_*`), which is available on the free Hobby tier.
- **MOCK integration responses** (for OPTIONS/CORS preflight) fail on LocalStack. CORS is handled by Lambda response headers instead (`Access-Control-Allow-Origin: *` on every response).
- **Lambda containers behind corporate proxy** can't reach external HTTPS URLs due to self-signed cert interception. The `pipeline-download` Lambda uses `NODE_TLS_REJECT_UNAUTHORIZED=0` as a LocalStack-only workaround.
- **Step Functions Parallel state** output replaces the state data with an array. Use `ResultPath` to merge parallel output into existing state data, preserving fields needed by later steps.
- **CloudWatch metrics** may not be populated by LocalStack services. Dashboard and alarm definitions are production-correct but may show no data locally. The Ops page's CloudWatch-dependent panels (Lambda metrics, log viewer) may show empty data in LocalStack.
- **EventBridge scheduled rules** may not fire reliably in LocalStack. The rules are created and can be verified, but automatic triggering may not work.

## Full Details

See `plan/handoff.md` for the complete backstory, all decisions made, data source details, module-by-module outcomes, and possible extensions.
