# Cheat Sheet

Quick reference for all the tools in this project. Every command assumes you're in the project root.

---

## npm scripts (the easy way)

Run `npm run` to see all available scripts.

```bash
# ─── LocalStack ──────────────────────────────────────────────────────
npm run localstack:up          # start LocalStack container
npm run localstack:down        # stop LocalStack container
npm run localstack:status      # check which services are running
npm run localstack:logs        # stream container logs (Ctrl+C to stop)
npm run localstack:reset       # nuke all data and restart fresh

# ─── AWS (quick checks) ─────────────────────────────────────────────
npm run aws:s3:ls              # list all S3 buckets
npm run aws:dynamo:tables      # list all DynamoDB tables

# ─── OpenTofu ────────────────────────────────────────────────────────
npm run tofu:init              # download providers (run once after clone)
npm run tofu:plan              # dry run — show what would change
npm run tofu:apply             # apply changes to LocalStack
npm run tofu:destroy           # tear down all managed infrastructure

# ─── TypeScript ──────────────────────────────────────────────────────
npm run build                  # compile TypeScript to dist/
npm run verify                 # smoke test: SDK talks to LocalStack
```

---

## AWS CLI (full reference)

All commands use `--profile localstack` which sets region, endpoint, and credentials automatically.

### S3 (object storage)

```bash
# List all buckets
aws --profile localstack s3 ls

# List contents of a bucket
aws --profile localstack s3 ls s3://BUCKET_NAME/

# List with human-readable sizes
aws --profile localstack s3 ls s3://BUCKET_NAME/ --human-readable

# Upload a file
aws --profile localstack s3 cp local-file.txt s3://BUCKET_NAME/remote-path.txt

# Download a file
aws --profile localstack s3 cp s3://BUCKET_NAME/remote-path.txt local-file.txt

# Upload a whole directory
aws --profile localstack s3 sync ./local-dir s3://BUCKET_NAME/prefix/

# Delete a file
aws --profile localstack s3 rm s3://BUCKET_NAME/remote-path.txt

# Delete a bucket and everything in it
aws --profile localstack s3 rb s3://BUCKET_NAME --force

# Create a bucket
aws --profile localstack s3 mb s3://BUCKET_NAME
```

### DynamoDB (NoSQL database)

```bash
# List all tables
aws --profile localstack dynamodb list-tables

# Describe a table (schema, indexes, item count)
aws --profile localstack dynamodb describe-table --table-name TABLE_NAME

# Scan a table (get all items — careful with large tables)
aws --profile localstack dynamodb scan --table-name TABLE_NAME

# Scan with limit
aws --profile localstack dynamodb scan --table-name TABLE_NAME --limit 5

# Get a single item by key
aws --profile localstack dynamodb get-item \
  --table-name TABLE_NAME \
  --key '{"pk": {"S": "some-key"}}'

# Query by partition key (much faster than scan for large tables)
aws --profile localstack dynamodb query \
  --table-name TABLE_NAME \
  --key-condition-expression "pk = :val" \
  --expression-attribute-values '{":val": {"S": "some-key"}}'

# Put (insert/overwrite) an item
aws --profile localstack dynamodb put-item \
  --table-name TABLE_NAME \
  --item '{"pk": {"S": "key1"}, "name": {"S": "hello"}}'

# Delete an item
aws --profile localstack dynamodb delete-item \
  --table-name TABLE_NAME \
  --key '{"pk": {"S": "some-key"}}'
```

### SQS (message queues) — Phase 2

```bash
# List all queues
aws --profile localstack sqs list-queues

# Send a message
aws --profile localstack sqs send-message \
  --queue-url http://localhost:4566/000000000000/QUEUE_NAME \
  --message-body '{"event": "resource-spawned"}'

# Receive messages (long-poll for up to 5 seconds)
aws --profile localstack sqs receive-message \
  --queue-url http://localhost:4566/000000000000/QUEUE_NAME \
  --wait-time-seconds 5

# Purge all messages from a queue
aws --profile localstack sqs purge-queue \
  --queue-url http://localhost:4566/000000000000/QUEUE_NAME
```

### SNS (pub/sub notifications) — Phase 2

```bash
# List all topics
aws --profile localstack sns list-topics

# Publish a message to a topic
aws --profile localstack sns publish \
  --topic-arn arn:aws:sns:us-east-1:000000000000:TOPIC_NAME \
  --message '{"type": "resource-spawned"}'

# List subscriptions
aws --profile localstack sns list-subscriptions
```

### Lambda (serverless functions) — Phase 3

```bash
# List all functions
aws --profile localstack lambda list-functions

# Invoke a function
aws --profile localstack lambda invoke \
  --function-name FUNCTION_NAME \
  --payload '{"key": "value"}' \
  /dev/stdout
```

---

## OpenTofu

```bash
# Initialize (download providers) — run once after clone
tofu -chdir=tofu init

# See what would change (dry run)
tofu -chdir=tofu plan

# Apply changes
tofu -chdir=tofu apply

# Apply without confirmation prompt
tofu -chdir=tofu apply -auto-approve

# Destroy all managed resources
tofu -chdir=tofu destroy

# List all resources in state
tofu -chdir=tofu state list

# Show details of a specific resource
tofu -chdir=tofu state show aws_s3_bucket.RESOURCE_NAME

# Per-phase commands (Phase 1 example)
tofu -chdir=tofu/phase1 init
tofu -chdir=tofu/phase1 plan
tofu -chdir=tofu/phase1 apply
```

---

## Docker / LocalStack

```bash
# Start LocalStack
docker compose up -d

# Stop LocalStack (data persists in volume)
docker compose down

# Stop and delete all data
docker compose down -v

# View logs
docker logs localstack
docker logs -f localstack          # follow (stream live)

# Check health
curl -s http://localhost:4566/_localstack/health | python3 -m json.tool

# Shell into the container (for debugging)
docker exec -it localstack bash

# Check which LocalStack image version is running
docker inspect localstack --format='{{.Config.Image}}'
```

---

## TypeScript / tsx

```bash
# Run any .ts file directly (no build step)
npx tsx src/some-script.ts

# Compile everything to dist/
npx tsc

# Type-check without emitting files
npx tsc --noEmit
```
