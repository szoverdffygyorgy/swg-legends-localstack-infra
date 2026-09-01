# EventBridge rules: scheduling and event detection.
#
# ┌─────────────────────────────────────────────────────────────┐
# │  What is EventBridge?                                       │
# │                                                             │
# │  AWS's central event bus. It does two things:               │
# │                                                             │
# │  1. SCHEDULING: "run X every N minutes/hours"               │
# │     Like cron, but managed. No server to keep running.      │
# │     EventBridge triggers a target (Lambda, Step Functions,  │
# │     SQS, etc.) on a schedule you define.                    │
# │                                                             │
# │  2. EVENT ROUTING: "when this pattern matches, do Y"        │
# │     AWS services emit events (Lambda invoked, SFN failed,   │
# │     S3 object created, etc.). EventBridge watches for       │
# │     patterns you define and routes matching events to       │
# │     targets.                                                │
# │                                                             │
# │  Without EventBridge, you'd need:                           │
# │    - A server running 24/7 with a cron job (for scheduling) │
# │    - Custom polling logic to detect failures (for events)   │
# │    - Your own retry/routing infrastructure                  │
# └─────────────────────────────────────────────────────────────┘

# ═══════════════════════════════════════════════════════════════════════
# RULE 1: Scheduled pipeline execution (every 2 hours)
# ═══════════════════════════════════════════════════════════════════════
# This replaces `npm run pipeline:start` with automatic execution.
# Every 2 hours, EventBridge triggers the Step Functions state machine.
# The state machine handles downloading, parsing, diffing, and all the
# pipeline steps automatically.
#
# schedule_expression supports two formats:
#   - rate(N minutes/hours/days): simple interval
#   - cron(min hour day month weekday year): precise schedule
# We use rate() for simplicity.

resource "aws_cloudwatch_event_rule" "pipeline_schedule" {
  name                = "swg-legends-pipeline-schedule"
  description         = "Trigger ingestion pipeline every 2 hours"
  schedule_expression = "rate(2 hours)"

  tags = {
    Project = "swg-legends"
    Module  = "monitoring"
    Purpose = "Scheduled pipeline execution"
  }
}

resource "aws_cloudwatch_event_target" "pipeline_sfn" {
  rule     = aws_cloudwatch_event_rule.pipeline_schedule.name
  arn      = data.aws_sfn_state_machine.pipeline.arn
  role_arn = aws_iam_role.eventbridge_sfn.arn

  # Input to the Step Functions execution (empty object = default)
  input = jsonencode({
    source    = "eventbridge-schedule"
    timestamp = "$${aws:Timestamp}"
  })
}

# ═══════════════════════════════════════════════════════════════════════
# RULE 2: Pipeline failure detection
# ═══════════════════════════════════════════════════════════════════════
# When a Step Functions execution fails, AWS emits an event to the
# default event bus. This rule matches those failure events and sends
# a notification to the pipeline-alerts SNS topic.
#
# Event pattern matching:
# - source: "aws.states" (Step Functions events)
# - detail-type: "Step Functions Execution Status Change"
# - detail.status: "FAILED", "TIMED_OUT", or "ABORTED"
#
# This is reactive monitoring: you don't poll for failures, the system
# tells you when they happen.

resource "aws_cloudwatch_event_rule" "pipeline_failure" {
  name        = "swg-legends-pipeline-failure"
  description = "Detect Step Functions pipeline failures"

  event_pattern = jsonencode({
    source      = ["aws.states"]
    detail-type = ["Step Functions Execution Status Change"]
    detail = {
      status          = ["FAILED", "TIMED_OUT", "ABORTED"]
      stateMachineArn = [data.aws_sfn_state_machine.pipeline.arn]
    }
  })

  tags = {
    Project = "swg-legends"
    Module  = "monitoring"
    Purpose = "Pipeline failure detection"
  }
}

resource "aws_cloudwatch_event_target" "pipeline_failure_sns" {
  rule = aws_cloudwatch_event_rule.pipeline_failure.name
  arn  = aws_sns_topic.pipeline_alerts.arn
}

# SNS needs a resource policy to allow EventBridge to publish to it
resource "aws_sns_topic_policy" "pipeline_alerts_policy" {
  arn = aws_sns_topic.pipeline_alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEventBridgePublish"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.pipeline_alerts.arn
      }
    ]
  })
}
