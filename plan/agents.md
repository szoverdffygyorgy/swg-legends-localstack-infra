# Project Context: SWG Legends Crafting & Resource Intelligence

## Purpose

A local AWS infrastructure learning project. The user is a software engineer learning AWS services hands-on by building a real tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends MMORPG server.

All AWS services run locally via **LocalStack** (Docker). Zero cloud costs. The SWG theme provides real data and real use cases to make the learning concrete.

## Current Status

- **Phase 0: Foundation** -- COMPLETE
- **Phase 1: Storage (S3 + DynamoDB)** -- COMPLETE
- Phase 2: Messaging (SQS + SNS) -- planned
- Phase 3: Compute (Lambda) -- planned
- Phase 4: API Layer (API Gateway) -- planned
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
  src/
    config.ts                 # Shared AWS client factories + constants
    types.ts                  # SWGResource, ResourceItem, ResourceStats types
    verify-localstack.ts      # Phase 0 smoke test
    ingest/
      download.ts             # Download + decompress SWGAide XML export
      parse-resources.ts      # Parse XML -> SWGResource[]
      upload-to-s3.ts         # Archive raw XML to S3
      load-resources.ts       # Denormalize + batch write to DynamoDB
      pipeline.ts             # Orchestrate full ingestion flow
    query/
      find-resources.ts       # Query by planet/class/stat with CLI args
    export/
      generate-dashboard.ts   # Generate Bazaar Terminal HTML dashboard
  data/                       # Downloaded XML + generated dashboard (gitignored)
```

## Teaching Approach

- Explain the **"why"** before the "how" for every AWS service and tool
- One technology group at a time -- discuss, then build
- Use real SWGAide data wherever possible
- The user is comfortable with TypeScript but new to AWS, IaC, and Docker Compose authoring

## Key npm Scripts

| Script | What it does |
|--------|-------------|
| `npm run ingest` | Full pipeline: download XML -> parse -> DynamoDB -> S3 |
| `npm run query -- --planet Tatooine` | Query resources by planet/class/stat |
| `npm run dashboard` | Generate Bazaar Terminal HTML dashboard |
| `npm run localstack:up` | Start LocalStack container |
| `npm run localstack:reset` | Wipe all data and restart fresh |
| `npm run tofu:apply` | Apply Phase 1 infrastructure |

## Known Future Additions

- **Resource class hierarchy** -- SWG has a deep tree (e.g., Mineral > Metal > Non-Ferrous Metal > Aluminum > Link-Steel Aluminum). Currently not in our data model. Needed for Phase 3 schematic matching. Plan: static TypeScript mapping file.
- **Schematics data** -- Crafting recipes from SWGAide's `schematics_unity.xml.gz`. Deferred until Phase 3.

## Full Details

See `plan/handoff.md` for the complete backstory, all decisions made, data source details, and the full phase plan.
