# IAM (Identity and Access Management) for Lambda functions.
#
# In real AWS, IAM is critical security infrastructure. Every service
# needs explicit permission to access other services. A Lambda function
# can't read from DynamoDB or write to CloudWatch Logs unless its
# "execution role" grants those permissions.
#
# The model:
# 1. Create an IAM Role (an identity that can be "assumed" by a service)
# 2. Attach a "trust policy" that says "Lambda is allowed to assume this role"
# 3. Attach permission policies that say "this role can read SQS, write DynamoDB, etc."
#
# LocalStack doesn't enforce IAM by default, but we set it up correctly
# because in real AWS, missing IAM permissions is the #1 cause of
# "everything looks right but nothing works."

# ─── Lambda execution role ────────────────────────────────────────────
# This is the role that both Lambda functions will assume.
# The "assume_role_policy" is the trust policy: it says "the Lambda
# service is allowed to use this role."

resource "aws_iam_role" "lambda_execution" {
  name = "swg-legends-lambda-execution"

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
    Phase   = "3"
    Purpose = "Lambda execution role"
  }
}

# ─── DynamoDB permissions ─────────────────────────────────────────────
# Allow the Lambda functions to read/write the DynamoDB tables they need.
# In real AWS, you'd scope this down to specific table ARNs.
# For LocalStack, we use a wildcard for simplicity.

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "lambda-dynamodb-access"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchWriteItem",
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/*"
      }
    ]
  })
}

# ─── SQS permissions ─────────────────────────────────────────────────
# Allow Lambda to receive and delete messages from SQS queues.
# The event source mapping (in event-sources.tf) handles polling,
# but Lambda needs explicit permission to interact with the queue.

resource "aws_iam_role_policy" "lambda_sqs" {
  name = "lambda-sqs-access"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = "arn:aws:sqs:${var.aws_region}:*:*"
      }
    ]
  })
}

# ─── CloudWatch Logs permissions ──────────────────────────────────────
# Lambda automatically writes execution logs to CloudWatch Logs.
# It needs permission to create log groups and write log events.

resource "aws_iam_role_policy" "lambda_logs" {
  name = "lambda-cloudwatch-logs"
  role = aws_iam_role.lambda_execution.id

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
