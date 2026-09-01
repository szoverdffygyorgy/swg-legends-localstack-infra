# IAM for orchestration module: pipeline Lambda functions and Step Functions.
#
# Two roles needed:
# 1. Lambda execution role -- for the 7 pipeline Lambdas to access
#    S3, DynamoDB, SNS, and CloudWatch Logs
# 2. Step Functions execution role -- for the state machine to invoke
#    the Lambda functions

# ─── Lambda execution role ────────────────────────────────────────────

resource "aws_iam_role" "pipeline_lambda_execution" {
  name = "swg-legends-pipeline-lambda-execution"

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
    Module  = "orchestration"
    Purpose = "Pipeline Lambda execution role"
  }
}

# S3 permissions (read/write for inter-step data + archive)
resource "aws_iam_role_policy" "pipeline_lambda_s3" {
  name = "pipeline-lambda-s3-access"
  role = aws_iam_role.pipeline_lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:CopyObject",
        ]
        Resource = [
          "arn:aws:s3:::swg-legends-raw-exports",
          "arn:aws:s3:::swg-legends-raw-exports/*",
        ]
      }
    ]
  })
}

# DynamoDB permissions
resource "aws_iam_role_policy" "pipeline_lambda_dynamodb" {
  name = "pipeline-lambda-dynamodb-access"
  role = aws_iam_role.pipeline_lambda_execution.id

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
          "dynamodb:BatchWriteItem",
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/*"
      }
    ]
  })
}

# SNS permissions (for publish-sns step)
resource "aws_iam_role_policy" "pipeline_lambda_sns" {
  name = "pipeline-lambda-sns-access"
  role = aws_iam_role.pipeline_lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = "arn:aws:sns:${var.aws_region}:*:*"
      }
    ]
  })
}

# CloudWatch Logs permissions
resource "aws_iam_role_policy" "pipeline_lambda_logs" {
  name = "pipeline-lambda-cloudwatch-logs"
  role = aws_iam_role.pipeline_lambda_execution.id

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

# ─── Step Functions execution role ────────────────────────────────────
# Step Functions needs permission to invoke the Lambda functions.

resource "aws_iam_role" "sfn_execution" {
  name = "swg-legends-sfn-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Project = "swg-legends"
    Module  = "orchestration"
    Purpose = "Step Functions execution role"
  }
}

resource "aws_iam_role_policy" "sfn_invoke_lambda" {
  name = "sfn-invoke-lambda"
  role = aws_iam_role.sfn_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "arn:aws:lambda:${var.aws_region}:*:function:pipeline-*"
      }
    ]
  })
}
