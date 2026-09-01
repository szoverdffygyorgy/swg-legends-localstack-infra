# SNS topic for pipeline operational alerts.
#
# When the ingestion pipeline fails, EventBridge detects it and publishes
# a notification to this topic. In a real setup, you'd subscribe an email
# address or a Slack webhook to this topic. For LocalStack, we just create
# the topic to demonstrate the pattern.

resource "aws_sns_topic" "pipeline_alerts" {
  name = "pipeline-alerts"

  tags = {
    Project = "swg-legends"
    Module  = "monitoring"
    Purpose = "Pipeline failure notifications"
  }
}
