# Project Handoff: SWG Legends Crafting & Resource Intelligence

## Overview

A local AWS infrastructure playground for learning AWS services by building a real, useful tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends server (NGE). All AWS services are emulated locally via LocalStack -- zero cloud costs.

**All 6 phases are complete**, plus a React frontend. The system ingests real SWG resource data from swgaide.com, stores it in DynamoDB, publishes spawn/despawn events via SNS/SQS, evaluates alert rules via Lambda, exposes everything through a REST API, orchestrates the ingestion pipeline via Step Functions, schedules automatic runs via EventBridge, monitors health via CloudWatch, and presents it all in a browser-based React dashboard.

## Decisions Made (Before Development)

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Cloud provider | AWS | User preference |
| Language | TypeScript | User preference, type safety for data models, AWS SDK v3 support |
| IaC tool | OpenTofu (NOT Terraform) | Same HCL syntax, open-source (MPL 2.0), avoids BSL license concerns |
| Local AWS emulation | LocalStack (Docker) | Free tier covers all services we need |
| Game / theme | SWG Legends (NGE server) | User is semi-active player, closest to their heart |
| Data source | swgaide.com XML exports | Real player-reported resource data for SWG Legends |
| Approach | Phase-by-phase | User wants to learn incrementally, discuss each phase before moving on |
| Teaching style | "Why before how" | User wants to understand tradeoffs and when to use what |

## Decisions Made (During Development)

These decisions were made as we built each phase, based on what we learned along the way:

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| API Gateway version | REST API v1 (not HTTP API v2) | LocalStack free tier doesn't support v2. v1 is more verbose but teaches more concepts. |
| API Lambda grouping | 3 Lambdas by domain (resources, events, alerts) | Sweet spot between 1 monolith (too broad) and 7 individual (too granular). Real-world pattern. |
| CORS approach | Lambda response headers (not MOCK OPTIONS) | LocalStack's MOCK integration responses fail. Each Lambda returns `Access-Control-Allow-Origin: *`. |
| Step Functions data passing | S3 as inter-step scratch space | Parsed resource array (~575 items) exceeds the 256 KB payload limit between states. Standard pattern. |
| Pipeline schedule | `rate(2 hours)` | SWGAide data doesn't change that frequently. 30 min was overkill for a learning project. |
| Corporate proxy in Lambda | `NODE_TLS_REJECT_UNAUTHORIZED=0` | Lambda containers can't reach swgaide.com through the corporate proxy. Dev-only workaround. |
| Frontend framework | React + Vite (not Next.js) | Next.js is a backend framework -- it would duplicate or replace the API Gateway + Lambda backend we spent 4 phases building. React SPA keeps the frontend as a pure consumer of the REST API. |
| Frontend color theme | SWG NGE in-game UI palette | Dark navy backgrounds, pale blue text, warm gold accents. Comfortable for extended use, themed to the game. |
| S3 static website hosting | Separate bucket `swg-legends-frontend` | Demonstrates a real AWS hosting pattern (S3 + public read policy). Deployed via a TypeScript build script. |

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
- Schematics (all servers, "unity" format): `https://swgaide.com/pub/exports/schematics_unity.xml.gz` (not yet used)

**Resource Stats (11 attributes):**
- ER (Entangle Resistance), CR (Cold Resistance), CD (Conductivity), DR (Decay Resistance)
- FL (Flavor), HR (Heat Resistance), MA (Malleability), PE (Potential Energy)
- OQ (Overall Quality), SR (Shock Resistance), UT (Unit Toughness)

**Resource Class Hierarchy:**
- Full tree at `https://swgaide.com/resources/restree.php`
- Hierarchical: e.g., Mineral > Metal > Ferrous Metal > Iron > Dolovite Iron > [planet-specific]
- Each class has min/max caps per stat
- Not yet modeled in the system (see Possible Extensions)

**No REST API** -- only XML data exports and HTML pages. This is actually good for learning: we built an ingestion pipeline (download, decompress, parse XML, transform, store).

### SWG Legends Server Info
- Server ID on SWGAide: 138
- Server type: NGE
- ~575 active resources at any given time
- Active reporter community (resources are player-reported)

## What Was Built: Phase Summary

### Phase 0: Foundation -- COMPLETE
**AWS Services:** None (setup only)

Set up the local development environment: Docker Compose for LocalStack, OpenTofu provider configuration, TypeScript project with AWS SDK v3, npm scripts, AWS CLI profile for LocalStack.

### Phase 1: Storage (S3 + DynamoDB) -- COMPLETE
**AWS Services:** S3, DynamoDB

- **S3 bucket** (`swg-legends-raw-exports`): stores timestamped XML export archives
- **DynamoDB tables:**
  - `resources` -- current spawns, denormalized (one item per resource-planet pair), with `by-planet` and `by-class` GSIs
  - `resource-history` -- despawned resources with timestamps
- **Ingestion pipeline script** (`npm run ingest`): download, decompress, parse, diff, load, archive
- **Query script** (`npm run query`): filter by planet, class, stat thresholds
- **Bazaar Terminal HTML dashboard** (`npm run dashboard`): static HTML with sortable table, filters, event log, alert panels

*Deferred: schematics table (not needed without schematic matching features)*

### Phase 2: Messaging (SQS + SNS) -- COMPLETE
**AWS Services:** SQS, SNS

- **SNS topics:** `resource-spawned`, `resource-despawned` (broadcast events)
- **SQS queues:** `alert-evaluator`, `history-recorder` (+ DLQs for each)
- **SNS → SQS subscriptions:** fan-out pattern (one event, multiple consumers)
- **DynamoDB tables:**
  - `event-log` -- chronological log of all spawn/despawn/data-issue events (partitioned by date)
  - `alert-rules` -- single-table pattern with `pk=RULE` for rules and `pk=FIRED` for fired alerts
- **Diff engine:** compare fresh XML against DynamoDB, detect new/removed resources
- **Alert rules CLI:** `npm run alerts:add`, `alerts:list`, `alerts:remove`, `alerts:history`

### Phase 3: Compute (Lambda) -- COMPLETE
**AWS Services:** Lambda, IAM

- **Lambda functions:**
  - `alert-evaluator` -- triggered by SQS, checks spawned resources against alert rules, writes FIRED items
  - `history-recorder` -- triggered by SQS, writes despawned resources to resource-history table
- **SQS → Lambda event source mappings:** auto-trigger on message arrival
- **IAM roles and policies:** Lambda execution role with DynamoDB, SQS, CloudWatch Logs permissions
- **Build system:** esbuild bundling + zip + deploy via `npm run lambda:build`

*Deferred: quality scorer Lambda, "best resource for schematic" Lambda (requires schematics data)*

### Phase 4: API Layer (API Gateway) -- COMPLETE
**AWS Services:** API Gateway (REST API v1)

- **REST API** with 7 endpoints:
  - `GET /resources` -- list with `?planet=`, `?class=`, `?stat=` + `?min=` filters
  - `GET /resources/{id}` -- specific resource by ID
  - `GET /events` -- spawn/despawn events with `?date=` and `?type=` filters
  - `GET /alerts/rules` -- list alert rules
  - `POST /alerts/rules` -- create alert rule
  - `DELETE /alerts/rules/{ruleId}` -- delete alert rule
  - `GET /alerts/history` -- fired alert history
- **3 Lambda functions** (domain-grouped): `api-get-resources`, `api-get-events`, `api-alerts`
- **Lambda proxy integration:** API Gateway passes full HTTP request to Lambda, Lambda returns full HTTP response
- **CORS headers** on every Lambda response
- **Smoke test suite** (`npm run api:test`): 15 tests covering all endpoints, validation, error cases
- **Deployment + Stage:** `dev` stage with manual deployment

### Phase 5: Orchestration (Step Functions) -- COMPLETE
**AWS Services:** Step Functions

- **State machine** (`swg-legends-ingestion-pipeline`) with 7 steps:
  - `DownloadExport` → `ParseXML` → `DiffResources` → `HasChanges` (Choice)
  - If changes: `UpdateDynamoDB` → `LogAndPublish` (Parallel: LogEvents + PublishSNS) → `ArchiveToS3`
  - If no changes: `ArchiveToS3`
- **7 pipeline Lambda functions:** `pipeline-download`, `pipeline-parse`, `pipeline-diff`, `pipeline-update-db`, `pipeline-log-events`, `pipeline-publish-sns`, `pipeline-archive`
- **S3 inter-step storage:** parsed resources and diff results stored in S3 temp files, cleaned up by archive step
- **Retry policies:** every step retries 2-3 times with exponential backoff
- **Catch blocks:** failures route to `PipelineFailed` terminal state
- **Choice state:** skips update/log/publish when no resources changed
- **Parallel state:** LogEvents and PublishSNS run simultaneously
- **CLI scripts:** `npm run pipeline:start`, `npm run pipeline:status`

### Phase 6: Events & Monitoring (EventBridge + CloudWatch) -- COMPLETE
**AWS Services:** EventBridge, CloudWatch, SNS

- **EventBridge scheduled rule:** triggers Step Functions pipeline every 2 hours
- **EventBridge failure detection rule:** matches SFN execution failures, publishes to `pipeline-alerts` SNS topic
- **CloudWatch dashboard** (`swg-legends-ops`): production-correct JSON definition with Lambda invocations/duration/errors, SQS queue depth, SFN execution stats widgets
- **CloudWatch alarm** (`swg-legends-pipeline-failures`): triggers on 2+ pipeline failures per hour
- **SNS topic** (`pipeline-alerts`): receives failure notifications from EventBridge and CloudWatch
- **Ops dashboard** (`npm run dashboard:ops`): HTML dashboard querying all LocalStack services for real operational data (system health, pipeline history, infrastructure inventory, alert status)

### Frontend -- COMPLETE
**Tech:** React 19, Vite 6, TypeScript, React Router 7

- **3 pages:** Resources (filterable/sortable table), Events (date-based feed with type filters), Alerts (CRUD form + fired history)
- **SWG NGE color theme:** dark navy backgrounds, pale blue text, warm gold accents (CSS custom properties)
- **Vite dev server** with API proxy to LocalStack API Gateway (`http://localhost:3000`)
- **S3 static website hosting:** bucket `swg-legends-frontend` with public read policy
- **Deploy script** (`npm run frontend:deploy`): builds React app with API URL baked in, uploads to S3
- **Typed API client:** fetch wrapper matching all Lambda response shapes

## AWS Services Used

| Service | Purpose | Phase |
|---------|---------|-------|
| S3 | Raw XML archives, inter-step pipeline data, frontend hosting | 1, 5, Frontend |
| DynamoDB | Resources, resource history, event log, alert rules | 1, 2 |
| SNS | Spawn/despawn event broadcasting, pipeline failure alerts | 2, 6 |
| SQS | Message queuing with DLQs for reliable processing | 2 |
| Lambda | SQS consumers, API handlers, pipeline steps (12 total) | 3, 4, 5 |
| IAM | Execution roles for Lambda, Step Functions, EventBridge | 3, 4, 5, 6 |
| API Gateway | REST API with 7 HTTP endpoints | 4 |
| Step Functions | Ingestion pipeline orchestration (state machine) | 5 |
| EventBridge | Scheduled pipeline execution, failure detection | 6 |
| CloudWatch | Dashboard, metrics, alarms | 6 |

## Infrastructure Summary

| Resource | Count |
|----------|-------|
| Lambda functions | 12 (2 SQS-triggered, 3 API, 7 pipeline) |
| DynamoDB tables | 4 (resources, resource-history, event-log, alert-rules) |
| S3 buckets | 2 (raw-exports, frontend) |
| SNS topics | 3 (resource-spawned, resource-despawned, pipeline-alerts) |
| SQS queues | 4 (alert-evaluator, history-recorder + 2 DLQs) |
| API Gateway endpoints | 7 |
| Step Functions state machines | 1 (7 states + 2 terminal) |
| EventBridge rules | 2 (schedule + failure detection) |
| CloudWatch dashboards | 1 |
| CloudWatch alarms | 1 |
| IAM roles | 4 (Phase 3 Lambda, Phase 4 API Lambda, Phase 5 pipeline Lambda + SFN) |
| OpenTofu state directories | 7 (phase1-6 + frontend) |

## Quick Start from Scratch

If LocalStack data is wiped or you're starting fresh:

```bash
# 1. Start LocalStack
npm run localstack:up

# 2. Provision all infrastructure (order matters)
tofu -chdir=tofu/phase1 init && tofu -chdir=tofu/phase1 apply -auto-approve
tofu -chdir=tofu/phase2 init && tofu -chdir=tofu/phase2 apply -auto-approve
tofu -chdir=tofu/phase3 init && tofu -chdir=tofu/phase3 apply -auto-approve
tofu -chdir=tofu/phase4 init && tofu -chdir=tofu/phase4 apply -auto-approve
tofu -chdir=tofu/phase5 init && tofu -chdir=tofu/phase5 apply -auto-approve
tofu -chdir=tofu/phase6 init && tofu -chdir=tofu/phase6 apply -auto-approve
tofu -chdir=tofu/frontend init && tofu -chdir=tofu/frontend apply -auto-approve

# 3. Build and deploy all Lambda functions
npm run lambda:build

# 4. Ingest data (first run = full load)
npm run ingest

# 5. Add alert rules
npm run alerts:add -- --name "Good Copper" --class Copper --stat oq --min 800
npm run alerts:add -- --name "Any Reactive Gas" --class "Reactive Gas"

# 6. Deploy frontend
npm run frontend:deploy

# 7. Verify everything works
npm run api:test           # 15 API endpoint tests
npm run pipeline:start     # Run the Step Functions pipeline
npm run pipeline:status    # Check it succeeded
npm run frontend:dev       # Start React dev server at http://localhost:3000
```

## Recommended First Message in New Session

> Read plan/handoff.md and plan/agents.md for full project context. The system is fully built (Phases 0-6 + React frontend). LocalStack should be running. [Describe what you want to do or change.]

## User Context

- Semi-active SWG Legends player
- Also plays EVE Online and World of Tanks -- may build similar projects for those later
- Now has hands-on experience with: S3, DynamoDB, SNS, SQS, Lambda, API Gateway, Step Functions, EventBridge, CloudWatch, IAM, OpenTofu, Docker Compose
- Comfortable with TypeScript, React, and the AWS SDK v3
- Understands "why" each AWS service exists and when to use it
- Wants to understand tradeoffs, not just implementations
- Prefers learning the widely-used, general-purpose tools first; niche things later

## Possible Extensions

These are natural next steps if the project continues:

### High Value
- **Schematics data + "best resource for schematic" endpoint** -- Parse SWGAide's `schematics_unity.xml.gz`, store crafting recipes with resource class requirements and stat weight profiles. Add `GET /schematics/{name}/best-resources` API endpoint. This was in the original plan but deferred because it requires the resource class hierarchy first.
- **Resource class hierarchy** -- Static TypeScript mapping of SWG's deep class tree (Mineral > Metal > Non-Ferrous Metal > Copper > Desh Copper). Would make alert rules and schematic matching smarter -- "alert on any Copper subclass" instead of substring matching.

### Medium Value
- **Frontend improvements** -- Resource detail view (click a row to see full info), real-time pipeline status page, WebSocket for live event feed, dark/light theme toggle.
- **Cognito (authentication)** -- Add user auth to the API Gateway. Each user gets their own alert rules. LocalStack support is limited but the concepts transfer to real AWS.
- **DynamoDB Streams** -- React to DynamoDB changes in real-time instead of going through SNS. Alternative architecture worth understanding.

### Educational / Comparative
- **CloudFormation or CDK** -- Rewrite the IaC in AWS-native tooling for comparison with OpenTofu. See the tradeoffs firsthand.
- **Deploy to real AWS** -- The OpenTofu definitions are production-correct (modulo LocalStack workarounds). Deploying to a real AWS account would be a small step and would make CloudWatch dashboards, EventBridge schedules, and IAM policies actually functional.
- **CI/CD pipeline** -- GitHub Actions to run `tofu plan`, `lambda:build`, `api:test`, and `frontend:deploy` on push.

## Important Notes

- Always explain the "why" before building the "how"
- Use real SWGAide data (SWG Legends, server 138) wherever possible
- The primary goal is learning AWS infrastructure; the SWG tool is the vehicle
- OpenTofu commands use `tofu` instead of `terraform` (e.g., `tofu init`, `tofu plan`, `tofu apply`)
- LocalStack free tier does NOT include: API Gateway v2, Cognito, CloudFront, RDS, ECS, EKS
- The corporate proxy (Ion Group HTTPS interception) affects Lambda containers reaching external URLs
