# Lambda function definitions.
#
# Each Lambda function needs:
# - A zip file containing the handler code (uploaded separately)
# - A runtime (nodejs22.x)
# - A handler path (file.functionName)
# - An execution role (IAM)
# - Memory and timeout settings
#
# The actual code is built and deployed by scripts/build-lambdas.ts.
# OpenTofu creates the function definition pointing at a placeholder
# zip, and the build script updates the code.
#
# We use "filename" with a dummy zip for initial creation. The build
# script will update the function code via the AWS SDK after.

# ─── Placeholder zip ──────────────────────────────────────────────────
# OpenTofu needs a zip file to create the Lambda. We'll create a minimal
# placeholder that gets replaced by the real code during deployment.

data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' });"
    filename = "index.js"
  }
}

# ─── Alert Evaluator Lambda ──────────────────────────────────────────
# Triggered by messages in the alert-evaluator SQS queue.
# Checks each spawned resource against alert rules in DynamoDB.
# Fires matching alerts (writes FIRED items to alert-rules table).

resource "aws_lambda_function" "alert_evaluator" {
  function_name = "alert-evaluator"
  role          = aws_iam_role.lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.lambda_placeholder.output_path
  timeout       = 30 # seconds
  memory_size   = 128 # MB (minimum, plenty for our use case)

  environment {
    variables = {
      # Inside the Lambda execution environment (a sub-container),
      # "localhost" refers to the Lambda container itself, not LocalStack.
      # We use "host.docker.internal" which Docker resolves to the host
      # machine, where LocalStack's port 4566 is exposed.
      LOCALSTACK_ENDPOINT    = "http://host.docker.internal:4566"
      AWS_REGION_CUSTOM      = var.aws_region
      ALERT_RULES_TABLE      = "alert-rules"
      RESOURCE_CLASSES_TABLE  = "resource-classes"
    }
  }

  tags = {
    Project = "swg-legends"
    Module  = "compute"
    Purpose = "Evaluate spawned resources against alert rules"
  }
}

# ─── History Recorder Lambda ─────────────────────────────────────────
# Triggered by messages in the history-recorder SQS queue.
# Writes despawned resources to the resource-history DynamoDB table.

resource "aws_lambda_function" "history_recorder" {
  function_name = "history-recorder"
  role          = aws_iam_role.lambda_execution.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = data.archive_file.lambda_placeholder.output_path
  timeout       = 30
  memory_size   = 128

  environment {
    variables = {
      LOCALSTACK_ENDPOINT    = "http://host.docker.internal:4566"
      AWS_REGION_CUSTOM      = var.aws_region
      RESOURCE_HISTORY_TABLE = "resource-history"
    }
  }

  tags = {
    Project = "swg-legends"
    Module  = "compute"
    Purpose = "Record despawned resources to history table"
  }
}
