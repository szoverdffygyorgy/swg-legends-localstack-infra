# Project Handoff: SWG Legends Crafting & Resource Intelligence

## Overview

A local AWS infrastructure playground for learning AWS services by building a real, useful tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends server (NGE). All AWS services are emulated locally via LocalStack -- zero cloud costs.

**All 8 modules are complete**, plus a React frontend and a schematics crafting data pipeline. The system ingests real SWG resource data from swgaide.com, stores it in DynamoDB, publishes spawn/despawn events via SNS/SQS, evaluates hierarchy-aware alert rules via Lambda, exposes everything through a REST API (14 endpoints), orchestrates the ingestion pipeline via Step Functions, schedules automatic runs via EventBridge, monitors health via CloudWatch, classifies all resources against a full 816-node class hierarchy, ingests 3,673 crafting schematics with ingredient and experimental stat weight data, and presents it all in a browser-based React dashboard (powered by TanStack Query) with a persistent class tree sidebar, resource profile pages with stat bar visualizations and "Used In Schematics" integration, historical resource browsing, ops monitoring, and alert-as-filter integration with enable/disable toggle.

## Decisions Made (Before Development)

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Cloud provider | AWS | User preference |
| Language | TypeScript | User preference, type safety for data models, AWS SDK v3 support |
| IaC tool | OpenTofu (NOT Terraform) | Same HCL syntax, open-source (MPL 2.0), avoids BSL license concerns |
| Local AWS emulation | LocalStack (Docker) | Free tier covers all services we need |
| Game / theme | SWG Legends (NGE server) | User is semi-active player, closest to their heart |
| Data source | swgaide.com XML exports | Real player-reported resource data for SWG Legends |
| Approach | Module-by-module | User wants to learn incrementally, discuss each module before moving on |
| Teaching style | "Why before how" | User wants to understand tradeoffs and when to use what |

## Decisions Made (During Development)

These decisions were made as we built each module, based on what we learned along the way:

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| API Gateway version | REST API v1 (not HTTP API v2) | LocalStack free tier doesn't support v2. v1 is more verbose but teaches more concepts. |
| API Lambda grouping | 3 Lambdas by domain (resources, events, alerts) + 2 ops Lambdas | Sweet spot between monolith and individual. Additional ops Lambdas for pipeline status and dashboard. |
| CORS approach | Lambda response headers (not MOCK OPTIONS) | LocalStack's MOCK integration responses fail. Each Lambda returns `Access-Control-Allow-Origin: *`. |
| Step Functions data passing | S3 as inter-step scratch space | Parsed resource array (~575 items) exceeds the 256 KB payload limit between states. Standard pattern. |
| Pipeline schedule | `rate(2 hours)` | SWGAide data doesn't change that frequently. 30 min was overkill for a learning project. |
| Corporate proxy in Lambda | `NODE_TLS_REJECT_UNAUTHORIZED=0` | Lambda containers can't reach swgaide.com through the corporate proxy. Dev-only workaround. |
| Frontend framework | React + Vite (not Next.js) | Next.js is a backend framework -- it would duplicate or replace the API Gateway + Lambda backend we spent 4 modules building. React SPA keeps the frontend as a pure consumer of the REST API. |
| Frontend color theme | SWG NGE in-game UI palette | Dark navy backgrounds, pale blue text, warm gold accents. Comfortable for extended use, themed to the game. |
| S3 static website hosting | Separate bucket `swg-legends-frontend` | Demonstrates a real AWS hosting pattern (S3 + public read policy). Deployed via a TypeScript build script. |
| Resource class hierarchy | One-time scrape + static JSON + DynamoDB | Scraped 816 nodes from SWGAide's resource tree page, stored as static JSON (checked into repo), seeded to DynamoDB with GSIs. Hierarchy-aware matching in alerts and queries. |
| Class tree delivery to frontend | S3 at runtime (not bundled) | Class tree JSON served from S3, Vite proxies to S3 in dev. Keeps the frontend bundle small and allows tree updates without rebuilds. |
| Alert rule format evolution | `statThresholds` + `planets` (backward compatible) | New format supports multiple stat thresholds (AND logic) and planet filters (OR logic). Legacy `stat`/`minValue` format still read for backward compatibility. |
| Frontend data fetching | TanStack Query (React Query) | Replaced manual `useState`/`useEffect`/`fetch` patterns across all 7 data-fetching components. Provides caching, background refetching, optimistic updates, `refetchInterval` (fixes stale sync indicator), and React Query DevTools. |
| Schematics class ID mapping | 815-entry JSON from 46 SWGAide server exports + manual curation | SWGAide uses abbreviations (e.g., `mtl` for Metal, `cpr` for Copper) in schematics XML. Built complete mapping by aggregating all 46 server resource exports for leaf classes, plus hand-curating ~104 branch/parent nodes. Static game data, checked into repo. |
| Schematics ingestion approach | One-time seed (not periodic pipeline) | Schematics are static game data -- they only change when the game is patched (extremely rare). No need for a Step Functions pipeline. Simple download + parse + batch write. |
| Schematics DynamoDB design | Single-table with CLASS# ingredient index | `pk=SCHEM#{id}, sk=META` for metadata + `pk=CLASS#{className}, sk=SCHEM#{id}` for reverse ingredient index. Enables "find schematics that use Metal" with a single query. Same single-table pattern as alert-rules. |

## Installed Tools

| Tool | Version | Status |
|------|---------|--------|
| Docker | 29.7.2 | Installed |
| Node.js | v24.13.0 (via nvm) | Installed |
| npm | 11.6.2 | Installed |
| AWS CLI | 2.34.50 | Installed |
| Python 3 | 3.14.5 | Installed |
| OpenTofu | Installed | Installed (via `brew install opentofu`) |

## Data Sources

### SWGAide (swgaide.com)

Primary data source. Aggregates resource data from SWGAide app, swgcraft.org, and galaxyharvester.net.

**XML Exports (gzipped):**
- Current resources for SWG Legends: `https://swgaide.com/pub/exports/currentresources_138.xml.gz`
- Schematics (all servers, "unity" format): `https://swgaide.com/pub/exports/schematics_unity.xml.gz` -- **fully integrated.** 3,673 schematics (2,040 NGE + 1,633 pre-CU) parsed and loaded into DynamoDB.

**Resource Stats (11 attributes):**
- ER (Entangle Resistance), CR (Cold Resistance), CD (Conductivity), DR (Decay Resistance)
- FL (Flavor), HR (Heat Resistance), MA (Malleability), PE (Potential Energy)
- OQ (Overall Quality), SR (Shock Resistance), UT (Unit Toughness)

**Resource Class Hierarchy:**
- Full tree at `https://swgaide.com/resources/restree.php`
- Hierarchical: e.g., Mineral > Metal > Ferrous Metal > Iron > Dolovite Iron > [planet-specific]
- Each class has min/max caps per stat
- **Fully modeled and integrated.** Scraped from SWGAide into a static 816-node JSON tree (`src/data/resource-class-tree.json`), seeded to a `resource-classes` DynamoDB table with `by-parent` and `by-path` GSIs, and used for hierarchy-aware alert matching, resource enrichment (`classPath`, `classCategory`, `classGroup`), and a collapsible sidebar in the frontend.

**No REST API** -- only XML data exports and HTML pages. This is actually good for learning: we built an ingestion pipeline (download, decompress, parse XML, transform, store).

### SWG Legends Server Info
- Server ID on SWGAide: 138
- Server type: NGE
- ~575 active resources at any given time
- Active reporter community (resources are player-reported)

## What Was Built: Module Summary

### Foundation -- COMPLETE
**AWS Services:** None (setup only)

Set up the local development environment: Docker Compose for LocalStack, OpenTofu provider configuration, TypeScript project with AWS SDK v3, npm scripts, AWS CLI profile for LocalStack.

### Storage (S3 + DynamoDB) -- COMPLETE
**AWS Services:** S3, DynamoDB

- **S3 bucket** (`swg-legends-raw-exports`): stores timestamped XML export archives
- **DynamoDB tables:**
  - `resources` -- current spawns, denormalized (one item per resource-planet pair), with `by-planet` and `by-category` GSIs. Resources enriched with `classPath`, `classCategory`, `classGroup`.
  - `resource-history` -- despawned resources with timestamps, enriched with classification fields (`classPath`, `classCategory`, `classGroup`) and flattened stats. Has `by-category` GSI mirroring the resources table for hierarchy-aware queries.
- **Ingestion pipeline script** (`npm run ingest`): download, decompress, parse, diff, load, archive
- **Query script** (`npm run query`): filter by planet, class, stat thresholds
- **Bazaar Terminal HTML dashboard** (`npm run dashboard`): static HTML with sortable table, filters, event log, alert panels

### Messaging (SQS + SNS) -- COMPLETE
**AWS Services:** SQS, SNS

- **SNS topics:** `resource-spawned`, `resource-despawned` (broadcast events)
- **SQS queues:** `alert-evaluator`, `history-recorder` (+ DLQs for each)
- **SNS → SQS subscriptions:** fan-out pattern (one event, multiple consumers)
- **DynamoDB tables:**
  - `event-log` -- chronological log of all spawn/despawn/data-issue events (partitioned by date). Also stores pipeline metadata records (e.g., `date: "META", sk: "lastSync"` written by the archive step).
  - `alert-rules` -- single-table pattern with `pk=RULE` for rules and `pk=FIRED` for fired alerts
- **Diff engine:** compare fresh XML against DynamoDB, detect new/removed resources
- **Ingestion validation:** pipeline and CLI warn on unknown resource classes (DATA_ISSUE events in event-log)
- **Alert rules CLI:** `npm run alerts:add`, `alerts:list`, `alerts:remove`, `alerts:history`

### Compute (Lambda) -- COMPLETE
**AWS Services:** Lambda, IAM

- **Lambda functions:**
  - `alert-evaluator` -- triggered by SQS, checks spawned resources against alert rules using hierarchy-aware class matching, writes FIRED items
  - `history-recorder` -- triggered by SQS, enriches despawned resources with classification data (`classPath`, `classCategory`, `classGroup`) from the `resource-classes` table, flattens stats to top-level attributes for DynamoDB filtering, writes to resource-history table
- **SQS → Lambda event source mappings:** auto-trigger on message arrival
- **IAM roles and policies:** Lambda execution role with DynamoDB, SQS, CloudWatch Logs permissions
- **Build system:** esbuild bundling + zip + deploy via `npm run lambda:build`

### API (API Gateway) -- COMPLETE
**AWS Services:** API Gateway (REST API v1)

- **REST API** with 14 endpoints:
  - `GET /resources` -- list with `?planet=`, `?category=`, `?stat=` + `?min=` filters
  - `GET /resources/{id}` -- specific resource by ID
  - `GET /history` -- list past (despawned) resources with `?class=`, `?stat=` + `?min=`, `?name=` filters (hierarchy-aware, uses by-category GSI)
  - `GET /history/{id}` -- specific despawned resource by ID (most recent despawn)
  - `GET /events` -- spawn/despawn events with `?date=` and `?type=` filters
  - `GET /alerts/rules` -- list alert rules
  - `POST /alerts/rules` -- create alert rule
  - `PUT /alerts/rules/{ruleId}` -- toggle alert rule enabled/disabled
  - `DELETE /alerts/rules/{ruleId}` -- delete alert rule
  - `GET /alerts/history` -- fired alert history
  - `GET /pipeline/status` -- last sync time and pipeline execution info (used by header sync indicator)
  - `GET /ops/dashboard` -- aggregated ops data (DynamoDB, Step Functions, CloudWatch Metrics, SQS, CloudWatch Logs)
  - `GET /schematics` -- list/search schematics with `?class=` (hierarchy-aware ingredient index), `?name=`, `?category=`, `?base=` filters
  - `GET /schematics/{id}` -- full schematic detail with ingredients and experimental groups
- **7 Lambda functions** (domain-grouped): `api-get-resources`, `api-get-events`, `api-get-history`, `api-alerts`, `api-pipeline-status`, `api-ops-dashboard`, `api-get-schematics`
- **Lambda proxy integration:** API Gateway passes full HTTP request to Lambda, Lambda returns full HTTP response
- **CORS headers** on every Lambda response
- **Smoke test suite** (`npm run api:test`): tests covering all endpoints, validation, error cases
- **Deployment + Stage:** `dev` stage with manual deployment

### Orchestration (Step Functions) -- COMPLETE
**AWS Services:** Step Functions

- **State machine** (`swg-legends-ingestion-pipeline`) with 7 steps:
  - `DownloadExport` → `ParseXML` → `DiffResources` → `HasChanges` (Choice)
  - If changes: `UpdateDynamoDB` → `LogAndPublish` (Parallel: LogEvents + PublishSNS) → `ArchiveToS3`
  - If no changes: `ArchiveToS3`
- **7 pipeline Lambda functions:** `pipeline-download`, `pipeline-parse`, `pipeline-diff`, `pipeline-update-db`, `pipeline-log-events`, `pipeline-publish-sns`, `pipeline-archive`
- **Archive step** writes `lastSync` metadata record to event-log table (`date: "META", sk: "lastSync"`) for frontend sync indicator
- **S3 inter-step storage:** parsed resources and diff results stored in S3 temp files, cleaned up by archive step
- **Retry policies:** every step retries 2-3 times with exponential backoff
- **Catch blocks:** failures route to `PipelineFailed` terminal state
- **Choice state:** skips update/log/publish when no resources changed
- **Parallel state:** LogEvents and PublishSNS run simultaneously
- **CLI scripts:** `npm run pipeline:start`, `npm run pipeline:status`

### Monitoring (EventBridge + CloudWatch) -- COMPLETE
**AWS Services:** EventBridge, CloudWatch, SNS

- **EventBridge scheduled rule:** triggers Step Functions pipeline every 2 hours
- **EventBridge failure detection rule:** matches SFN execution failures, publishes to `pipeline-alerts` SNS topic
- **CloudWatch dashboard** (`swg-legends-ops`): production-correct JSON definition with Lambda invocations/duration/errors, SQS queue depth, SFN execution stats widgets
- **CloudWatch alarm** (`swg-legends-pipeline-failures`): triggers on 2+ pipeline failures per hour
- **SNS topic** (`pipeline-alerts`): receives failure notifications from EventBridge and CloudWatch
- **Ops dashboard** (`npm run dashboard:ops`): HTML dashboard querying all LocalStack services for real operational data (system health, pipeline history, infrastructure inventory, alert status)

### Classification -- COMPLETE
**AWS Services:** DynamoDB

- **One-time scrape script** (`scripts/scrape-resource-tree.ts`, `npm run scrape:tree`): fetches the full resource class hierarchy from SWGAide's `restree.php` page
- **Static JSON** (`src/data/resource-class-tree.json`): 816-node hierarchy checked into the repo
- **DynamoDB table** (`resource-classes`): stores all 816 class nodes with `by-parent` and `by-path` GSIs
- **Seed script** (`scripts/seed-resource-classes.ts`, `npm run seed:classes`): loads static JSON into DynamoDB
- **Backfill script** (`scripts/backfill-resource-classes.ts`, `npm run backfill:classes`): enriches existing resources with `classPath`, `classCategory`, `classGroup`
- **`by-category` GSI** on resources table: enables efficient queries by `classCategory` + `classPath`
- **OpenTofu module** (`tofu/classification/`): provisions the `resource-classes` table and GSIs
- **Hierarchy-aware alert matching:** "Metal" alert matches all metal subtypes (Ferrous, Non-Ferrous, Steel, Iron, Copper, etc.)
- **Ingestion validation:** unknown resource classes logged as DATA_ISSUE events

### Schematics -- COMPLETE
**AWS Services:** DynamoDB, Lambda, API Gateway

Crafting recipe data pipeline: download, parse, and store SWGAide schematics with ingredient resolution and experimental stat weights. Integrated into the Resource Profile page.

- **SWGAide class abbreviation mapping** (`src/data/swgaide-class-map.json`): 815-entry lookup from SWGAide abbreviations (e.g., `mtl`, `cpr`) to class names (e.g., "Metal", "Copper"). Built by aggregating resource exports from all 46 SWGAide servers for leaf classes + manual curation for 104 branch/parent nodes.
- **Download script** (`src/ingest/download-schematics.ts`): streaming gunzip of `schematics_unity.xml.gz`, 24-hour cache
- **Parser** (`src/ingest/parse-schematics.ts`): parses all 3,673 schematics (2,040 NGE + 1,633 pre-CU) with resolved class names, ingredient lists, and experimental stat weights. Zero unresolved class IDs.
- **DynamoDB table** (`schematics`): single-table design with two item types:
  - `pk=SCHEM#{id}, sk=META` -- schematic metadata (3,673 items)
  - `pk=CLASS#{className}, sk=SCHEM#{id}` -- ingredient reverse index (9,324 items)
  - `by-category` GSI for browsing by category
- **Seed script** (`scripts/seed-schematics.ts`, `npm run schematics:seed`): download + parse + batch write (12,997 items total)
- **Query script** (`src/query/find-schematics.ts`, `npm run schematics:query`): search by name, class, category, or ID
- **API endpoints** (via `api-get-schematics` Lambda):
  - `GET /schematics?class=Metal&hierarchy=true` -- hierarchy-aware ingredient index query (walks class tree ancestors)
  - `GET /schematics/{id}` -- full schematic detail with ingredients and experimental groups
- **Resource Profile integration:** "Used In Schematics" section shows matching schematics grouped by matched class level (e.g., "as Copper: 254", "as Metal: 1,052")
- **OpenTofu module** (`tofu/schematics/`): provisions the schematics DynamoDB table and GSIs
- **Types:** `Schematic`, `SchematicIngredient`, `ExperimentalGroup`, `ExperimentalProperty` in `src/types.ts`

### Frontend -- COMPLETE
**Tech:** React 19, Vite 6, TypeScript, React Router 7, TanStack Query (React Query)

- **6 pages:**
  - **Resources** -- persistent class tree sidebar (816-node collapsible hierarchy with search), filterable/sortable table with stat quality % display using dual color scales (purple > blue > green > yellow > red for both raw values and quality %), resource deduplication, Category column, color legend, alert dropdown to apply configured alerts as filters. Clickable rows navigate to Resource Profile.
  - **History** -- past (despawned) resources with class tree sidebar, alert preset dropdown, name search typeahead, stat threshold filters. Filter-first UX: page starts empty until a filter is active. Reuses ClassTreePicker component. Clickable rows navigate to Resource Profile.
  - **Resource Profile** (`/resources/:id`) -- dedicated detail page with parallel fetch from active + history tables. Shows Available/Despawned status badge, full classification breadcrumb, planet chips, spawn/despawn dates, reporter. StatBar component visualizes each stat on a 0-1000 scale with highlighted cap range [min, max], filled value position, and 5-tier raw-value color coding (950+/900+/800+/500+/<500). Cap min/max labels shown below each bar. **"Used In Schematics" section** shows hierarchy-aware schematic matches grouped by class level.
  - **Events** -- date-based feed with type filters
  - **Alerts** -- multi-threshold form (`statThresholds`), repeatable planet picker, class typeahead with hierarchy breadcrumbs, clickable enable/disable toggle button (green "Enabled" / amber "Disabled"), fired alert history. **Optimistic updates** on toggle (instant UI response with rollback on failure).
  - **Ops** (replaces Pipeline) -- system health bar, pipeline execution history, Lambda metrics (24h), SQS queue health, CloudWatch log viewer with function dropdown and auto-refresh. **Background refresh indicator** ("Refreshing..." with pulse animation) using `isFetching` vs `isLoading` distinction.
- **Header:** "Synced: Xh ago" indicator on every page (reads from `/pipeline/status`), **auto-updates every 60s** via `refetchInterval`, 5 nav tabs: Resources, History, Events, Alerts, Ops
- **TanStack Query (React Query):** All data fetching migrated from manual `useState`/`useEffect`/`fetch` to `useQuery`/`useMutation` hooks. Provides: automatic caching with stale-while-revalidate, background refetching on window focus, `refetchInterval` for polling, `keepPreviousData` for smooth filter transitions, optimistic updates on mutations, cache invalidation after create/delete/toggle operations.
- **Custom hooks layer** (`frontend/src/api/hooks.ts`): 16 hooks (12 queries + 3 mutations + query key factory) wrapping all API calls. Centralized query keys prevent typos and enable precise cache invalidation.
- **Shared utilities:** `utils/stats.ts` (stat quality display helpers), `utils/alerts.ts` (alert matching, label formatting, planet extraction) -- used by both Resources and History pages
- **Components:** ClassTreePicker (sidebar), StatBar (cap range visualization), StatusBadge, LoadingSpinner, ErrorMessage
- **SWG NGE color theme:** dark navy backgrounds, pale blue text, warm gold accents (CSS custom properties)
- **Class tree JSON** served from S3 at runtime (not bundled); Vite proxies to S3 in dev
- **Vite dev server** with API proxy to LocalStack API Gateway (`http://localhost:3000`)
- **S3 static website hosting:** bucket `swg-legends-frontend` with public read policy
- **Deploy script** (`npm run frontend:deploy`): builds React app with API URL baked in, uploads to S3
- **Typed API client:** fetch wrapper matching all Lambda response shapes, with TanStack Query hooks for each endpoint

## Alert Rule Format

Alert rules support hierarchy-aware class matching and multi-condition filtering:

```jsonc
{
  "pk": "RULE",
  "sk": "r_abc123",
  "name": "Good Copper",
  "resourceClass": "Copper",          // matches all Copper subtypes (Desh, Beyrllius, etc.)
  "statThresholds": {                  // AND logic: resource must meet ALL thresholds
    "oq": 800,
    "sr": 400
  },
  "planets": ["Tatooine", "Naboo"]    // OR logic: resource must be on ANY listed planet
}
```

- **Hierarchy-aware matching:** setting `resourceClass` to "Metal" matches all metal subtypes (Ferrous Metal, Non-Ferrous Metal, Steel, Iron, Copper, Aluminum, etc.)
- **Multiple stat thresholds:** AND logic -- resource must meet all specified minimums
- **Planet filter:** OR logic -- resource must be on at least one of the listed planets (empty = any planet)
- **Legacy format:** old rules with `stat`/`minValue` fields are still read, but new rules use `statThresholds`/`planets`

**CLI:**
```bash
npm run alerts:add -- --name "Good Copper" --class Copper --stat oq:800 --stat sr:400 --planet Tatooine
# --stat and --planet are repeatable
```

## AWS Services Used

| Service | Purpose | Module |
|---------|---------|--------|
| S3 | Raw XML archives, inter-step pipeline data, frontend hosting, class tree JSON | Storage, Orchestration, Frontend, Classification |
| DynamoDB | Resources, resource history, event log, alert rules, resource classes, schematics | Storage, Messaging, Classification, Schematics |
| SNS | Spawn/despawn event broadcasting, pipeline failure alerts | Messaging, Monitoring |
| SQS | Message queuing with DLQs for reliable processing | Messaging |
| Lambda | SQS consumers, API handlers, pipeline steps (17 total) | Compute, API, Orchestration, Schematics |
| IAM | Execution roles for Lambda, Step Functions, EventBridge | Compute, API, Orchestration, Monitoring |
| API Gateway | REST API with 14 HTTP endpoints | API |
| Step Functions | Ingestion pipeline orchestration (state machine) | Orchestration |
| EventBridge | Scheduled pipeline execution, failure detection | Monitoring |
| CloudWatch | Dashboard, metrics, alarms, logs | Monitoring |

## Infrastructure Summary

| Resource | Count |
|----------|-------|
| Lambda functions | 17 (2 SQS-triggered, 7 API, 7 pipeline, 1 ops dashboard) |
| DynamoDB tables | 6 (resources, resource-history, event-log, alert-rules, resource-classes, schematics) |
| S3 buckets | 2 (raw-exports, frontend) |
| SNS topics | 3 (resource-spawned, resource-despawned, pipeline-alerts) |
| SQS queues | 4 (alert-evaluator, history-recorder + 2 DLQs) |
| API Gateway endpoints | 14 |
| Step Functions state machines | 1 (7 states + 2 terminal) |
| EventBridge rules | 2 (schedule + failure detection) |
| CloudWatch dashboards | 1 |
| CloudWatch alarms | 1 |
| IAM roles | 4 (Compute Lambda, API Lambda, Orchestration pipeline Lambda + SFN) |
| OpenTofu state directories | 9 (storage, messaging, compute, api, orchestration, monitoring, frontend, classification, schematics) |

## Quick Start from Scratch

If LocalStack data is wiped or you're starting fresh:

```bash
# 1. Start LocalStack
npm run localstack:up

# 2. Provision all infrastructure (order matters)
tofu -chdir=tofu/storage init && tofu -chdir=tofu/storage apply -auto-approve
tofu -chdir=tofu/messaging init && tofu -chdir=tofu/messaging apply -auto-approve
tofu -chdir=tofu/compute init && tofu -chdir=tofu/compute apply -auto-approve
tofu -chdir=tofu/api init && tofu -chdir=tofu/api apply -auto-approve
tofu -chdir=tofu/orchestration init && tofu -chdir=tofu/orchestration apply -auto-approve
tofu -chdir=tofu/monitoring init && tofu -chdir=tofu/monitoring apply -auto-approve
tofu -chdir=tofu/frontend init && tofu -chdir=tofu/frontend apply -auto-approve
tofu -chdir=tofu/classification init && tofu -chdir=tofu/classification apply -auto-approve
tofu -chdir=tofu/schematics init && tofu -chdir=tofu/schematics apply -auto-approve

# 3. Seed resource class hierarchy
npm run seed:classes

# 4. Seed schematics data (3,673 schematics + ingredient index)
npm run schematics:seed

# 5. Build and deploy all Lambda functions
npm run lambda:build

# 5. Build and deploy all Lambda functions
npm run lambda:build

# 6. Ingest data (first run = full load)
npm run ingest

# 7. Backfill class metadata on resources (enriches classPath, classCategory, classGroup)
npm run backfill:classes

# 8. Backfill history items with classification data (if history table has existing data)
npm run backfill:history

# 9. Upload class tree JSON to S3 (needed by frontend sidebar)
# (check scripts or npm scripts for the exact upload command)

# 10. Add alert rules (new format with multi-threshold + planet filter)
npm run alerts:add -- --name "Good Copper" --class Copper --stat oq:800 --stat sr:400
npm run alerts:add -- --name "Any Reactive Gas" --class "Reactive Gas"
npm run alerts:add -- --name "Tatooine Metal" --class Metal --planet Tatooine

# 11. Deploy frontend
npm run frontend:deploy

# 12. Verify everything works
npm run api:test           # API endpoint tests
npm run pipeline:start     # Run the Step Functions pipeline
npm run pipeline:status    # Check it succeeded
npm run frontend:dev       # Start React dev server at http://localhost:3000
```

## Recommended First Message in New Session

> Read plan/handoff.md and plan/agents.md for full project context. The system is fully built (all 8 modules + schematics pipeline + React frontend with TanStack Query). LocalStack should be running. [Describe what you want to do or change.]

## User Context

- Semi-active SWG Legends player
- Also plays EVE Online and World of Tanks -- may build similar projects for those later
- Now has hands-on experience with: S3, DynamoDB, SNS, SQS, Lambda, API Gateway, Step Functions, EventBridge, CloudWatch, IAM, OpenTofu, Docker Compose
- Comfortable with TypeScript, React, TanStack Query, and the AWS SDK v3
- Understands "why" each AWS service exists and when to use it
- Wants to understand tradeoffs, not just implementations
- Prefers learning the widely-used, general-purpose tools first; niche things later

## Possible Extensions

Prioritized backlog organized by learning value and feature impact.

### Tier 1: High Value + New Infra Learning

These teach new AWS concepts while delivering meaningful features.

| Item | New Infra Learned | Feature Value |
|------|-------------------|---------------|
| **DynamoDB TTL (Time-To-Live)** | DynamoDB lifecycle management, automatic item expiration | Keeps event-log and history tables from growing unbounded |
| **Resource notifications (SNS email)** | SNS email subscriptions, delivery mechanisms | Makes alerts actually *alert* you -- fired alerts trigger real emails |
| **Lambda layers** | Lambda code sharing pattern | Cleans up duplicated classification cache loading across 5+ Lambdas |

### Tier 2: High Feature Value, Familiar Infra

These use patterns already learned but deliver strong user-facing results.

| Item | Why |
|------|-----|
| **Schematic Profile page** | Dedicated `/schematics/{id}` page showing full recipe detail, ingredient breakdown, and best current/historical resources for each slot. Foundation already in place (API endpoint exists, types defined). |
| **Best resource scoring endpoint** | `GET /schematics/{id}/best-resources` applies experimental stat weights to rank current resources per ingredient slot. The experimental weight data is already parsed and stored. |
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
| **Cognito (authentication)** | User auth for per-user alert rules. LocalStack support is limited but the concepts transfer to real AWS |

## Important Notes

- Always explain the "why" before building the "how"
- Use real SWGAide data (SWG Legends, server 138) wherever possible
- The primary goal is learning AWS infrastructure; the SWG tool is the vehicle
- OpenTofu commands use `tofu` instead of `terraform` (e.g., `tofu init`, `tofu plan`, `tofu apply`)
- LocalStack free tier does NOT include: API Gateway v2, Cognito, CloudFront, RDS, ECS, EKS
- The corporate proxy (Ion Group HTTPS interception) affects Lambda containers reaching external URLs
- New npm dependencies added: `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-cloudwatch-logs`
- Frontend npm dependencies added: `@tanstack/react-query`, `@tanstack/react-query-devtools`
