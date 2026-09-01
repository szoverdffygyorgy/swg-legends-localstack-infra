# Outputs for the monitoring module.

output "schedule_rule_name" {
  description = "EventBridge schedule rule name"
  value       = aws_cloudwatch_event_rule.pipeline_schedule.name
}

output "schedule_expression" {
  description = "How often the pipeline runs"
  value       = aws_cloudwatch_event_rule.pipeline_schedule.schedule_expression
}

output "failure_rule_name" {
  description = "EventBridge failure detection rule name"
  value       = aws_cloudwatch_event_rule.pipeline_failure.name
}

output "pipeline_alerts_topic_arn" {
  description = "SNS topic for pipeline failure notifications"
  value       = aws_sns_topic.pipeline_alerts.arn
}

output "dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = aws_cloudwatch_dashboard.ops.dashboard_name
}

output "alarm_name" {
  description = "CloudWatch alarm name for pipeline failures"
  value       = aws_cloudwatch_metric_alarm.pipeline_failures.alarm_name
}
