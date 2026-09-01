# Outputs for the orchestration module.

output "state_machine_arn" {
  description = "The ARN of the ingestion pipeline state machine"
  value       = aws_sfn_state_machine.ingestion_pipeline.arn
}

output "state_machine_name" {
  description = "The name of the state machine"
  value       = aws_sfn_state_machine.ingestion_pipeline.name
}

output "start_execution_command" {
  description = "AWS CLI command to start a pipeline execution"
  value       = "aws --endpoint-url ${var.localstack_endpoint} stepfunctions start-execution --state-machine-arn ${aws_sfn_state_machine.ingestion_pipeline.arn} --region ${var.aws_region}"
}
