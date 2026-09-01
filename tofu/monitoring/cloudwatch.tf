# CloudWatch dashboard and alarms.
#
# ┌─────────────────────────────────────────────────────────────┐
# │  What is CloudWatch?                                        │
# │                                                             │
# │  AWS's observability platform. Three main features:         │
# │                                                             │
# │  1. METRICS: numerical data points over time                │
# │     AWS services automatically emit metrics (Lambda          │
# │     duration, API Gateway 5xx errors, SQS queue depth).     │
# │     You can also publish custom metrics.                    │
# │                                                             │
# │  2. DASHBOARDS: visual displays of metrics                  │
# │     JSON-defined layouts with graphs, numbers, and text.    │
# │     In real AWS, these render as interactive web pages.     │
# │     In LocalStack, the definition is stored but there's     │
# │     no visual UI -- our ops dashboard script fills this gap.│
# │                                                             │
# │  3. ALARMS: "if metric X crosses threshold Y, do Z"        │
# │     Monitors a metric and triggers an action (SNS publish,  │
# │     Lambda invocation, etc.) when the threshold is breached.│
# └─────────────────────────────────────────────────────────────┘

# ═══════════════════════════════════════════════════════════════════════
# DASHBOARD: System overview
# ═══════════════════════════════════════════════════════════════════════
# Defines a CloudWatch dashboard with widgets for key system metrics.
# In real AWS, this would render as an interactive web page at:
#   https://console.aws.amazon.com/cloudwatch/home#dashboards:name=swg-legends-ops
#
# The dashboard body is a JSON document using the CloudWatch Dashboard
# Body Structure format. Each widget specifies:
#   - type: "metric" (graph), "text" (markdown), or "log" (log query)
#   - properties: what to display (metric namespace, name, stats, period)
#   - x, y, width, height: position on a 24-column grid

resource "aws_cloudwatch_dashboard" "ops" {
  dashboard_name = "swg-legends-ops"

  dashboard_body = jsonencode({
    widgets = [
      # ─── Header ───────────────────────────────────────────
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "# SWG Legends Operations Dashboard\nSystem health overview for the resource intelligence pipeline."
        }
      },

      # ─── Lambda Invocations ────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Invocations (24h)"
          region  = var.aws_region
          period  = 3600
          stat    = "Sum"
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "pipeline-download"],
            ["AWS/Lambda", "Invocations", "FunctionName", "pipeline-parse"],
            ["AWS/Lambda", "Invocations", "FunctionName", "pipeline-diff"],
            ["AWS/Lambda", "Invocations", "FunctionName", "pipeline-update-db"],
            ["AWS/Lambda", "Invocations", "FunctionName", "api-get-resources"],
            ["AWS/Lambda", "Invocations", "FunctionName", "api-alerts"],
          ]
        }
      },

      # ─── Lambda Duration ───────────────────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 2
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Duration (avg, 24h)"
          region  = var.aws_region
          period  = 3600
          stat    = "Average"
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", "pipeline-download"],
            ["AWS/Lambda", "Duration", "FunctionName", "pipeline-diff"],
            ["AWS/Lambda", "Duration", "FunctionName", "api-get-resources"],
            ["AWS/Lambda", "Duration", "FunctionName", "api-alerts"],
          ]
        }
      },

      # ─── Lambda Errors ─────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 8
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Errors (24h)"
          region  = var.aws_region
          period  = 3600
          stat    = "Sum"
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", "pipeline-download"],
            ["AWS/Lambda", "Errors", "FunctionName", "pipeline-parse"],
            ["AWS/Lambda", "Errors", "FunctionName", "pipeline-diff"],
            ["AWS/Lambda", "Errors", "FunctionName", "pipeline-update-db"],
            ["AWS/Lambda", "Errors", "FunctionName", "api-get-resources"],
            ["AWS/Lambda", "Errors", "FunctionName", "alert-evaluator"],
          ]
        }
      },

      # ─── SQS Queue Depth ──────────────────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 8
        width  = 12
        height = 6
        properties = {
          title   = "SQS Queue Depth"
          region  = var.aws_region
          period  = 300
          stat    = "Maximum"
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "alert-evaluator"],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "history-recorder"],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "alert-evaluator-dlq"],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "history-recorder-dlq"],
          ]
        }
      },

      # ─── Step Functions Executions ─────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 14
        width  = 24
        height = 6
        properties = {
          title   = "Step Functions Pipeline Executions"
          region  = var.aws_region
          period  = 3600
          stat    = "Sum"
          metrics = [
            ["AWS/States", "ExecutionsStarted", "StateMachineArn", data.aws_sfn_state_machine.pipeline.arn],
            ["AWS/States", "ExecutionsSucceeded", "StateMachineArn", data.aws_sfn_state_machine.pipeline.arn],
            ["AWS/States", "ExecutionsFailed", "StateMachineArn", data.aws_sfn_state_machine.pipeline.arn],
          ]
        }
      },
    ]
  })
}

# ═══════════════════════════════════════════════════════════════════════
# ALARM: Pipeline failure rate
# ═══════════════════════════════════════════════════════════════════════
# Triggers when the pipeline fails 2+ times in an hour.
# Action: publish to the pipeline-alerts SNS topic.
#
# In real AWS, this would send an email, page someone, or trigger
# a remediation Lambda. In LocalStack, the alarm state is tracked
# but the notification may not fire.

resource "aws_cloudwatch_metric_alarm" "pipeline_failures" {
  alarm_name          = "swg-legends-pipeline-failures"
  alarm_description   = "Pipeline failed 2+ times in the last hour"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ExecutionsFailed"
  namespace           = "AWS/States"
  period              = 3600
  statistic           = "Sum"
  threshold           = 2
  treat_missing_data  = "notBreaching"

  dimensions = {
    StateMachineArn = data.aws_sfn_state_machine.pipeline.arn
  }

  alarm_actions = [aws_sns_topic.pipeline_alerts.arn]
  ok_actions    = [aws_sns_topic.pipeline_alerts.arn]

  tags = {
    Project = "swg-legends"
    Module  = "monitoring"
    Purpose = "Pipeline failure alarm"
  }
}
