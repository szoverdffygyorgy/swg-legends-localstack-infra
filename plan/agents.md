# Project Context: SWG Legends Crafting & Resource Intelligence

## Purpose

A local AWS infrastructure learning project. The user is a software engineer learning AWS services hands-on by building a real tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends MMORPG server.

All AWS services run locally via **LocalStack** (Docker). Zero cloud costs. The SWG theme provides real data and real use cases to make the learning concrete.

## Current Status

- **Phase 0: Foundation** -- COMPLETE
- **Phase 1: Storage (S3 + DynamoDB)** -- COMPLETE
- **Phase 2: Messaging (SQS + SNS)** -- COMPLETE
- **Phase 3: Compute (Lambda)** -- COMPLETE
- **Phase 4: API Layer (API Gateway)** -- COMPLETE
- Phase 5: Orchestration (Step Functions) -- planned
- Phase 6: Events & Monitoring (EventBridge + CloudWatch) -- planned

## Key Conventions

| Convention | Detail |
|------------|--------|
| IaC tool | **OpenTofu** (NOT Terraform). Commands use `tofu`, not `terraform`. |
| Language | TypeScript |
| AWS emulation | LocalStack at `http://localhost:4566` |
| AWS region | `us-east-1` (arbitrary, LocalStack doesn't care) |
| AWS credentials | Dummy values (`test` / `test`) -- LocalStack ignores them but SDK requires them |
| Package manager | npm |
| Docker | `docker compose` (v2 syntax, no hyphen) |
| OpenTofu state | Per-phase directories under `tofu/` (each phase has its own state) |
| Data source | swgaide.com XML exports, SWG Legends server ID 138 |
| LocalStack auth | Requires `LOCALSTACK_AUTH_TOKEN` in `.env` (free Hobby tier) |
| Corporate proxy | Ion Group HTTPS interception; combined CA bundle mounted in Docker |

## Project Structure

```
swg-legends-localstack-infra/
  docker-compose.yml          # LocalStack container (with corporate proxy CA workaround)
  package.json                # TypeScript project, AWS SDK v3, npm scripts
  tsconfig.json               # TypeScript compiler config
  CHEATSHEET.md               # Copy-paste command reference
  .gitignore
  .env                        # LocalStack auth token (gitignored)
  .env.example                # Template for .env
  certs/                      # Corporate proxy CA bundle (gitignored)
  plan/
    handoff.md                # Full project backstory and phase plan
    agents.md                 # This file -- AI agent context
  tofu/
    main.tf                   # Root provider config (Phase 0)
    variables.tf              # Shared variables
    phase1/
      main.tf                 # Phase 1 provider config
      s3.tf                   # swg-legends-raw-exports bucket
      dynamodb.tf             # resources + resource-history tables
    phase2/
      main.tf                 # Phase 2 provider config
      sns.tf                  # resource-spawned + resource-despawned topics
      sqs.tf                  # history-recorder + alert-evaluator queues + DLQs
      subscriptions.tf        # SNS -> SQS fan-out wiring + queue policies
      dynamodb.tf             # event-log + alert-rules tables
    phase3/
      main.tf                 # Phase 3 provider config
      iam.tf                  # Lambda execution role + DynamoDB/SQS/Logs policies
      lambda.tf               # alert-evaluator + history-recorder Lambda definitions
      event-sources.tf        # SQS -> Lambda event source mappings
    phase4/
      main.tf                 # Phase 4 provider config
      iam.tf                  # API Lambda execution role + DynamoDB/Logs policies
      lambda.tf               # api-get-resources + api-get-events + api-alerts Lambdas
      api-gateway.tf          # REST API, resources, methods, integrations, deployment, stage
      outputs.tf              # API base URL + example curl commands
  src/
    config.ts                 # Shared AWS client factories + constants
    types.ts                  # SWGResource, ResourceItem, DiffResult, EventLogItem types
    verify-localstack.ts      # Phase 0 smoke test
    ingest/
      download.ts             # Download + decompress SWGAide XML export
      parse-resources.ts      # Parse XML -> SWGResource[]
      diff.ts                 # Compare XML against DynamoDB, produce spawn/despawn lists
      load-resources.ts       # Full load + incremental add/remove for DynamoDB
      log-events.ts           # Write spawn/despawn events to event-log table
      upload-to-s3.ts         # Archive raw XML to S3
      pipeline.ts             # Orchestrate full ingestion flow (7 steps)
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
    lambda/
      alert-evaluator/
        handler.ts            # Lambda: evaluate spawns against alert rules
      history-recorder/
        handler.ts            # Lambda: record despawns to history table
      api-get-resources/
        handler.ts            # Lambda: GET /resources, GET /resources/{id}
      api-get-events/
        handler.ts            # Lambda: GET /events
      api-alerts/
        handler.ts            # Lambda: /alerts/rules CRUD + /alerts/history
    api/
      test-api.ts             # Smoke test for all API endpoints
  scripts/
    build-lambdas.ts          # esbuild bundle + zip + deploy Lambdas to LocalStack
  data/                       # Downloaded XML + generated dashboard (gitignored)
  dist/lambda/                # Built Lambda zip files (gitignored)
```

## Teaching Approach

- Explain the **"why"** before the "how" for every AWS service and tool
- One technology group at a time -- discuss, then build
- Use real SWGAide data wherever possible
- The user is comfortable with TypeScript but new to AWS, IaC, and Docker Compose authoring

## Key npm Scripts

| Script | What it does |
|--------|-------------|
| `npm run ingest` | Full pipeline: download -> diff -> DynamoDB -> events -> SNS -> S3 |
| `npm run diff` | Show spawn/despawn diff without modifying anything |
| `npm run query -- --planet Tatooine` | Query resources by planet/class/stat |
| `npm run events` | Show today's spawn/despawn events |
| `npm run process:history` | Drain history SQS queue -> resource-history table |
| `npm run process:alerts` | Drain alerts SQS queue -> check rules -> fire alerts |
| `npm run alerts:add -- --name X --class Y` | Add an alert rule |
| `npm run alerts:list` | Show all alert rules |
| `npm run alerts:history` | Show fired alert history |
| `npm run lambda:build` | Build + bundle + deploy Lambda functions to LocalStack |
| `npm run dashboard` | Generate Bazaar Terminal HTML dashboard |
| `npm run localstack:up` | Start LocalStack container |
| `npm run localstack:reset` | Wipe all data and restart fresh |
| `npm run api:test` | Smoke test all API Gateway endpoints |
| `npm run tofu:init:phase4` | Initialize Phase 4 OpenTofu |
| `npm run tofu:apply:phase4` | Apply Phase 4 infrastructure |

## Known Future Additions

- **Resource class hierarchy** -- SWG has a deep tree (e.g., Mineral > Metal > Non-Ferrous Metal > Aluminum > Link-Steel Aluminum). Currently not in our data model. Needed for Phase 3 schematic matching. Plan: static TypeScript mapping file.
- **Schematics data** -- Crafting recipes from SWGAide's `schematics_unity.xml.gz`. Deferred until Phase 3.

## Known LocalStack Limitations

- **API Gateway v2 (HTTP API)** requires a paid LocalStack license. Phase 4 uses REST API v1 (`aws_api_gateway_*`), which is available on the free Hobby tier.
- **MOCK integration responses** (for OPTIONS/CORS preflight) fail on LocalStack. CORS is handled by Lambda response headers instead (`Access-Control-Allow-Origin: *` on every response).

## Full Details

See `plan/handoff.md` for the complete backstory, all decisions made, data source details, and the full phase plan.
