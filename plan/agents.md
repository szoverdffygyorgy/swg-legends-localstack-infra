# Project Context: SWG Legends Crafting & Resource Intelligence

## Purpose

A local AWS infrastructure learning project. The user is a software engineer learning AWS services hands-on by building a real tool: a crafting and resource intelligence system for the Star Wars Galaxies (SWG) Legends MMORPG server.

All AWS services run locally via **LocalStack** (Docker). Zero cloud costs. The SWG theme provides real data and real use cases to make the learning concrete.

## Current Status

- **Phase 0: Foundation** -- IN PROGRESS
- Phase 1: Storage (S3 + DynamoDB) -- planned
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

## Project Structure

```
swg-legends-localstack-infra/
  docker-compose.yml          # LocalStack container
  package.json                # TypeScript project, AWS SDK v3
  tsconfig.json               # TypeScript compiler config
  .gitignore
  plan/
    handoff.md                # Full project backstory and phase plan
    agents.md                 # This file -- AI agent context
  tofu/
    main.tf                   # AWS provider config (LocalStack endpoint)
    variables.tf              # Shared variables
    phase1/                   # Phase 1 infrastructure (S3, DynamoDB)
  src/                        # TypeScript source code
  scripts/                    # Utility scripts
  data/                       # Downloaded XML exports (gitignored)
```

## Teaching Approach

- Explain the **"why"** before the "how" for every AWS service and tool
- One technology group at a time -- discuss, then build
- Use real SWGAide data wherever possible
- The user is comfortable with TypeScript but new to AWS, IaC, and Docker Compose authoring

## Full Details

See `plan/handoff.md` for the complete backstory, all decisions made, data source details, and the full phase plan.
