# IAM for Phase 4 API Lambda functions.
#
# We create a new execution role for the API Lambdas, separate from
# the Phase 3 role. In real AWS, you'd typically have one role per
# Lambda (or per group of related Lambdas) scoped to exactly the
# resources each function needs. We follow this pattern even though
# LocalStack doesn't enforce IAM.
#
# Why not reuse the Phase 3 role?
# Each phase has its own OpenTofu state. Cross-referencing resources
# between states requires remote state data sources or imports, which
# adds complexity. It's simpler (and more realistic) for each phase
# to own its IAM roles — and in production, the API Lambdas might
# need different permissions than the SQS-triggered Lambdas anyway.

# ─── Lambda execution role ────────────────────────────────────────────
# Trust policy: "Lambda is allowed to assume this role."

resource "aws_iam_role" "api_lambda_execution" {
  name = "swg-legends-api-lambda-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Project = "swg-legends"
    Phase   = "4"
    Purpose = "API Lambda execution role"
  }
}

# ─── DynamoDB permissions ─────────────────────────────────────────────
# The API Lambdas need to read/write across tables from multiple phases:
# - resources (Phase 1) — for GET /resources
# - resource-history (Phase 1) — for future history endpoint
# - event-log (Phase 2) — for GET /events
# - alert-rules (Phase 2) — for /alerts/* endpoints

resource "aws_iam_role_policy" "api_lambda_dynamodb" {
  name = "api-lambda-dynamodb-access"
  role = aws_iam_role.api_lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/*"
      }
    ]
  })
}

# ─── CloudWatch Logs permissions ──────────────────────────────────────

resource "aws_iam_role_policy" "api_lambda_logs" {
  name = "api-lambda-cloudwatch-logs"
  role = aws_iam_role.api_lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      }
    ]
  })
}
