# Lambda functions for the ingestion pipeline.
#
# Seven functions, one per pipeline step:
#
# 1. pipeline-download   — download XML from SWGAide, upload to S3
# 2. pipeline-parse      — parse XML into SWGResource JSON, store in S3
# 3. pipeline-diff       — compare parsed data against DynamoDB
# 4. pipeline-update-db  — add spawned / remove despawned resources
# 5. pipeline-log-events — write events to event-log table
# 6. pipeline-publish-sns — publish spawn/despawn to SNS topics
# 7. pipeline-archive    — archive raw XML to permanent S3 path

# ─── Placeholder zip ──────────────────────────────────────────────────

data "archive_file" "pipeline_lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' });"
    filename = "index.js"
  }
}

# ─── Shared environment variables ─────────────────────────────────────
# All pipeline Lambdas need the same base config.

locals {
  pipeline_env = {
    LOCALSTACK_ENDPOINT    = "http://host.docker.internal:4566"
    AWS_REGION_CUSTOM      = var.aws_region
    RAW_EXPORTS_BUCKET     = "swg-legends-raw-exports"
    RESOURCES_TABLE        = "resources"
    EVENT_LOG_TABLE        = "event-log"
    RESOURCE_CLASSES_TABLE = "resource-classes"
  }
}

# ─── pipeline-download ────────────────────────────────────────────────

resource "aws_lambda_function" "pipeline_download" {
  function_name = "pipeline-download"
  role          = aws_iam_role.pipeline_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.pipeline_lambda_placeholder.output_path
  timeout       = 60 # Downloading from external URL may be slow
  memory_size   = 256

  environment {
    variables = merge(local.pipeline_env, {
      # The Lambda container runs behind the corporate proxy which
      # intercepts HTTPS with a self-signed certificate. In a real
      # AWS environment, the Lambda would have direct internet access.
      # This is a LocalStack/corporate-proxy-only workaround.
      NODE_TLS_REJECT_UNAUTHORIZED = "0"
    })
  }

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Pipeline: download SWGAide XML export"
  }
}

# ─── pipeline-parse ──────────────────────────────────────────────────

resource "aws_lambda_function" "pipeline_parse" {
  function_name = "pipeline-parse"
  role          = aws_iam_role.pipeline_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.pipeline_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 256

  environment {
    variables = local.pipeline_env
  }

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Pipeline: parse XML into resources"
  }
}

# ─── pipeline-diff ───────────────────────────────────────────────────

resource "aws_lambda_function" "pipeline_diff" {
  function_name = "pipeline-diff"
  role          = aws_iam_role.pipeline_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.pipeline_lambda_placeholder.output_path
  timeout       = 60 # Full DynamoDB scan may take a moment
  memory_size   = 256

  environment {
    variables = local.pipeline_env
  }

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Pipeline: diff resources against DynamoDB"
  }
}

# ─── pipeline-update-db ──────────────────────────────────────────────

resource "aws_lambda_function" "pipeline_update_db" {
  function_name = "pipeline-update-db"
  role          = aws_iam_role.pipeline_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.pipeline_lambda_placeholder.output_path
  timeout       = 60
  memory_size   = 256

  environment {
    variables = local.pipeline_env
  }

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Pipeline: update DynamoDB with spawn/despawn changes"
  }
}

# ─── pipeline-log-events ─────────────────────────────────────────────

resource "aws_lambda_function" "pipeline_log_events" {
  function_name = "pipeline-log-events"
  role          = aws_iam_role.pipeline_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.pipeline_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = local.pipeline_env
  }

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Pipeline: log events to event-log table"
  }
}

# ─── pipeline-publish-sns ────────────────────────────────────────────

resource "aws_lambda_function" "pipeline_publish_sns" {
  function_name = "pipeline-publish-sns"
  role          = aws_iam_role.pipeline_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.pipeline_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = local.pipeline_env
  }

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Pipeline: publish events to SNS topics"
  }
}

# ─── pipeline-archive ────────────────────────────────────────────────

resource "aws_lambda_function" "pipeline_archive" {
  function_name = "pipeline-archive"
  role          = aws_iam_role.pipeline_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.pipeline_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = local.pipeline_env
  }

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Pipeline: archive raw XML to permanent S3 path"
  }
}
