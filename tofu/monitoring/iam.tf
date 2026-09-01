# IAM for monitoring module: EventBridge needs permission to start Step Functions
# executions and publish to SNS.

# ─── EventBridge execution role ───────────────────────────────────────
# EventBridge (CloudWatch Events) assumes this role when triggering
# the Step Functions pipeline on schedule.

resource "aws_iam_role" "eventbridge_sfn" {
  name = "swg-legends-eventbridge-sfn"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Project = "swg-legends"
    Module  = "monitoring"
    Purpose = "EventBridge -> Step Functions execution role"
  }
}

resource "aws_iam_role_policy" "eventbridge_start_sfn" {
  name = "eventbridge-start-sfn-execution"
  role = aws_iam_role.eventbridge_sfn.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["states:StartExecution"]
        Resource = data.aws_sfn_state_machine.pipeline.arn
      }
    ]
  })
}

# ─── Data source: look up the orchestration module's state machine ─────
# We reference the state machine by name rather than hardcoding the ARN.
# This keeps the modules loosely coupled.

data "aws_sfn_state_machine" "pipeline" {
  name = "swg-legends-ingestion-pipeline"
}
