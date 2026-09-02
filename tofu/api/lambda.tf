# Lambda functions for the API layer.
#
# Three functions, one per domain area:
#
# 1. api-get-resources — handles GET /resources and GET /resources/{id}
#    Reads from the "resources" DynamoDB table (storage module).
#
# 2. api-get-events — handles GET /events
#    Reads from the "event-log" DynamoDB table (messaging module).
#
# 3. api-alerts — handles all /alerts/* endpoints
#    Reads/writes the "alert-rules" DynamoDB table (messaging module).
#
# Like the compute module, we create the functions with a placeholder zip file.
# The real code is deployed by scripts/build-lambdas.ts after running
# `npm run lambda:build`.

# ─── Placeholder zip ──────────────────────────────────────────────────

data "archive_file" "api_lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' });"
    filename = "index.js"
  }
}

# ─── api-get-resources ────────────────────────────────────────────────

resource "aws_lambda_function" "api_get_resources" {
  function_name = "api-get-resources"
  role          = aws_iam_role.api_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.api_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = {
      LOCALSTACK_ENDPOINT    = "http://host.docker.internal:4566"
      AWS_REGION_CUSTOM      = var.aws_region
      RESOURCES_TABLE        = "resources"
      RESOURCE_CLASSES_TABLE = "resource-classes"
    }
  }

  tags = {
    Project = "swg-legends"
    Module  = "api"
    Purpose = "API: list/get current resources"
  }
}

# ─── api-get-events ──────────────────────────────────────────────────

resource "aws_lambda_function" "api_get_events" {
  function_name = "api-get-events"
  role          = aws_iam_role.api_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.api_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = {
      LOCALSTACK_ENDPOINT = "http://host.docker.internal:4566"
      AWS_REGION_CUSTOM   = var.aws_region
      EVENT_LOG_TABLE     = "event-log"
    }
  }

  tags = {
    Project = "swg-legends"
    Module  = "api"
    Purpose = "API: list spawn/despawn events"
  }
}

# ─── api-alerts ──────────────────────────────────────────────────────

resource "aws_lambda_function" "api_alerts" {
  function_name = "api-alerts"
  role          = aws_iam_role.api_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.api_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = {
      LOCALSTACK_ENDPOINT = "http://host.docker.internal:4566"
      AWS_REGION_CUSTOM   = var.aws_region
      ALERT_RULES_TABLE   = "alert-rules"
    }
  }

  tags = {
    Project = "swg-legends"
    Module  = "api"
    Purpose = "API: alert rules CRUD + fired history"
  }
}

# ─── api-pipeline-status ──────────────────────────────────────────────
# Handles GET /pipeline/status
# Reads last sync metadata from event-log table and queries
# Step Functions for execution history.

data "aws_sfn_state_machine" "pipeline" {
  name = "swg-legends-ingestion-pipeline"
}

resource "aws_lambda_function" "api_pipeline_status" {
  function_name = "api-pipeline-status"
  role          = aws_iam_role.api_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.api_lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = {
      LOCALSTACK_ENDPOINT = "http://host.docker.internal:4566"
      AWS_REGION_CUSTOM   = var.aws_region
      EVENT_LOG_TABLE     = "event-log"
      STATE_MACHINE_ARN   = data.aws_sfn_state_machine.pipeline.arn
    }
  }

  tags = {
    Project = "swg-legends"
    Module  = "api"
    Purpose = "API: pipeline status and execution history"
  }
}

# ─── api-ops-dashboard ────────────────────────────────────────────────
# Handles GET /ops/dashboard
# Aggregates monitoring data from DynamoDB, Step Functions, CloudWatch,
# and SQS into a single response for the frontend Ops dashboard.

resource "aws_lambda_function" "api_ops_dashboard" {
  function_name = "api-ops-dashboard"
  role          = aws_iam_role.api_lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.api_lambda_placeholder.output_path
  timeout       = 60 # aggregates multiple AWS API calls
  memory_size   = 256

  environment {
    variables = {
      LOCALSTACK_ENDPOINT = "http://host.docker.internal:4566"
      AWS_REGION_CUSTOM   = var.aws_region
      EVENT_LOG_TABLE     = "event-log"
      STATE_MACHINE_ARN   = data.aws_sfn_state_machine.pipeline.arn
    }
  }

  tags = {
    Project = "swg-legends"
    Module  = "api"
    Purpose = "API: ops dashboard aggregation"
  }
}
