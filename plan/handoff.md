# Project Handoff: SWG Legends Crafting & Resource Intelligence

## Overview

A local AWS infrastructure playground for learning AWS services by building a real, useful tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends server (NGE). All AWS services are emulated locally via LocalStack -- zero cloud costs.

The user is a software engineer (beginner in infrastructure, some Docker experience) who wants to learn AWS services by building something real. The goal is understanding the "why" behind each service, not just the "how."

## Decisions Made

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

## Installed Tools (verified on user's machine)

| Tool | Version | Status |
|------|---------|--------|
| Docker | 29.7.2 | Installed |
| Node.js | v24.13.0 (via nvm) | Installed |
| npm | 11.6.2 | Installed |
| AWS CLI | 2.34.50 | Installed |
| Python 3 | 3.14.5 | Installed (not needed, but available) |
| OpenTofu | ? | NEEDS INSTALL (`brew install opentofu`) |

## Data Sources

### SWGAide (swgaide.com)

Primary data source. Aggregates resource data from SWGAide app, swgcraft.org, and galaxyharvester.net.

**XML Exports (gzipped):**
- Current resources for SWG Legends: `https://swgaide.com/pub/exports/currentresources_138.xml.gz`
- Schematics (all servers, "unity" format): `https://swgaide.com/pub/exports/schematics_unity.xml.gz`

**Resource Stats (11 attributes):**
- ER (Entangle Resistance), CR (Cold Resistance), CD (Conductivity), DR (Decay Resistance)
- FL (Flavor), HR (Heat Resistance), MA (Malleability), PE (Potential Energy)
- OQ (Overall Quality), SR (Shock Resistance), UT (Unit Toughness)

**Resource Class Hierarchy:**
- Full tree at `https://swgaide.com/resources/restree.php`
- Hierarchical: e.g., Mineral > Metal > Ferrous Metal > Iron > Dolovite Iron > [planet-specific]
- Each class has min/max caps per stat

**No REST API** -- only XML data exports and HTML pages. This is actually good for learning: we build an ingestion pipeline (download, decompress, parse XML, transform, store).

### SWG Legends Server Info
- Server ID on SWGAide: 138
- Server type: NGE
- ~575 active resources at time of research
- Active reporter community (resources are player-reported)

## Project Architecture: Phase Plan

### Phase 0: Foundation
**Goal:** Working local development environment.
**What to set up:**
- `docker-compose.yml` with LocalStack container
- OpenTofu configuration pointing at LocalStack (provider config)
- `package.json` with TypeScript, AWS SDK v3, build tooling
- `tsconfig.json`
- `.gitignore` (node_modules, .terraform, terraform.tfstate*, .env, downloaded XML data)
- AWS CLI alias/profile for LocalStack (`--endpoint-url http://localhost:4566`)
- Verify: can create an S3 bucket via both OpenTofu and AWS CLI against LocalStack

**Suggested project structure:**
```
swg-legends-localstack-infra/
  docker-compose.yml
  package.json
  tsconfig.json
  .gitignore
  tofu/
    main.tf              # Provider config (LocalStack endpoint)
    variables.tf         # Shared variables
    phase1/              # Phase 1 resources
  src/                   # TypeScript source
  scripts/               # Utility scripts
```

### Phase 1: Storage (S3 + DynamoDB)
**AWS Services:** S3, DynamoDB
**SWG Feature:** Resource database, schematic storage, resource survey snapshots

**What we build:**
- **S3 bucket:** Store raw XML exports from SWGAide (snapshots of resource data over time)
- **DynamoDB tables:**
  - `resources` -- current spawns with all 11 stats (partition key: resource_id or resource_name)
  - `schematics` -- crafting recipes with resource class requirements and quality weight profiles
  - `resource_history` -- past spawns for trend analysis ("was there ever a better copper?")
- **TypeScript scripts:**
  - Download and decompress SWGAide XML export
  - Parse XML into structured objects
  - Load into DynamoDB
  - Upload raw XML to S3 as archive
  - Query resources by type, planet, stat thresholds

**Key lessons:**
- When to use object storage (S3) vs NoSQL database (DynamoDB)
- DynamoDB key design: partition key, sort key, GSI
- S3 bucket operations: put, get, list, lifecycle policies

### Phase 2: Messaging (SQS + SNS)
**AWS Services:** SQS, SNS
**SWG Feature:** Resource spawn alerts ("tell me when good copper spawns")

**What we build:**
- SNS topics: `resource-spawned`, `resource-despawned`
- SQS queues: alert processor, history recorder, quality scorer (fan-out pattern)
- Alert rules engine: user-defined rules like "OQ > 900 AND resource_class = 'Copper'"
- Diff engine: compare current export vs previous to detect new/removed resources

**Key lessons:**
- Pub/sub vs point-to-point messaging
- Fan-out pattern (one event, multiple consumers)
- Dead letter queues (what happens when processing fails)
- Why not just call the other service directly? (decoupling, resilience, scalability)

### Phase 3: Compute (Lambda)
**AWS Services:** Lambda
**SWG Feature:** Resource quality scoring, "best resource finder"

**What we build:**
- Lambda: resource quality scorer (weighted score based on schematic requirements)
- Lambda: "best resource for schematic" finder
- Lambda: export diff calculator (detect spawn/despawn between two exports)
- Event-triggered: Lambda fires when SQS receives a new-resource message

**Key lessons:**
- Serverless compute model
- Cold starts and performance implications
- Event triggers (SQS -> Lambda, S3 -> Lambda)
- Why not just run a server? (cost, scaling, operational overhead tradeoffs)

### Phase 4: API Layer (API Gateway)
**AWS Services:** API Gateway
**SWG Feature:** REST API for all functionality

**Endpoints:**
- `GET /resources/current` -- list current spawns with filters (planet, class, stat thresholds)
- `GET /resources/{id}` -- specific resource details
- `GET /schematics/{name}/best-resources` -- optimal current resources for a schematic
- `POST /alerts` -- create spawn alert rules
- `GET /resources/history` -- historical resource data

**Key lessons:**
- API design and REST conventions
- Request routing and integration with Lambda
- Throttling and rate limiting
- Why not just expose Lambda directly? (routing, auth, rate limiting, versioning)

### Phase 5: Orchestration (Step Functions)
**AWS Services:** Step Functions
**SWG Feature:** Full crafting advisor pipeline, data ingestion workflow

**What we build:**
- **Data ingestion pipeline:** Download export -> Parse -> Diff against previous -> Store new resources -> Archive to S3 -> Publish events -> Update quality scores
- **Crafting advisor pipeline:** Input schematic -> Find matching resource classes -> Score all current resources -> Rank -> Return recommendations

**Key lessons:**
- State machines and workflow orchestration
- Error handling and retry logic
- Parallel execution branches
- When to use Step Functions vs just chaining Lambdas

### Phase 6: Events & Monitoring (EventBridge + CloudWatch)
**AWS Services:** EventBridge, CloudWatch
**SWG Feature:** Scheduled polling, system observability

**What we build:**
- EventBridge scheduled rule: poll SWGAide exports every 30 minutes
- EventBridge event rules: react to resource-spawned events
- CloudWatch dashboards: resource spawn rates, API usage, Lambda duration metrics
- CloudWatch alarms: alert if ingestion pipeline fails

**Key lessons:**
- Event-driven scheduling (cron in the cloud)
- Observability and monitoring
- Metrics, logs, alarms
- Why monitoring matters even for "simple" systems

## User Context

- Semi-active SWG Legends player
- Also plays EVE Online and World of Tanks -- may build similar projects for those later
- Wants to understand "why this service instead of doing it manually in code"
- Prefers learning the widely-used, general-purpose tools first; niche things later
- Comfortable with TypeScript/JavaScript development
- Has written Docker commands, seen docker-compose files, but not authored one
- Has seen Terraform/OpenTofu files but never written one
- Knows AWS concepts theoretically, limited hands-on experience

## What to Do Next

1. Install OpenTofu: `brew install opentofu`
2. Start Phase 0: Set up project structure, Docker Compose, OpenTofu config, TypeScript tooling
3. Verify everything works: LocalStack starts, OpenTofu can provision resources, AWS CLI can talk to LocalStack
4. Then proceed to Phase 1

## Recommended First Message in New Workspace

> Read plan/handoff.md and start Phase 0. Explain the "why" as you go.

## Important Notes

- Always explain the "why" before building the "how"
- Each phase should be discussed and understood before moving to the next
- Use real SWGAide data (SWG Legends, server 138) wherever possible
- The primary goal is learning AWS infrastructure; the SWG tool is the vehicle
- OpenTofu commands use `tofu` instead of `terraform` (e.g., `tofu init`, `tofu plan`, `tofu apply`)
