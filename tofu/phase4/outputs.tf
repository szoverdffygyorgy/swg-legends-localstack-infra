# Outputs — values displayed after `tofu apply` and available to scripts.
#
# The API base URL is the most important output. It's what you use to
# make HTTP requests to the API.
#
# LocalStack's REST API URL format:
#   http://localhost:4566/restapis/{api-id}/{stage}/_user_request_/
#
# This is different from real AWS, which uses:
#   https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/
#
# We construct the LocalStack-format URL so you can copy-paste it
# directly into curl or a browser.

output "api_id" {
  description = "The API Gateway REST API ID"
  value       = aws_api_gateway_rest_api.swg_api.id
}

output "stage_name" {
  description = "The deployed stage name"
  value       = aws_api_gateway_stage.dev.stage_name
}

output "api_base_url" {
  description = "Base URL for making API requests (LocalStack format)"
  value       = "${var.localstack_endpoint}/restapis/${aws_api_gateway_rest_api.swg_api.id}/${aws_api_gateway_stage.dev.stage_name}/_user_request_"
}

output "example_requests" {
  description = "Example curl commands to test the API"
  value = <<-EOT
    # List all resources:
    curl ${var.localstack_endpoint}/restapis/${aws_api_gateway_rest_api.swg_api.id}/${aws_api_gateway_stage.dev.stage_name}/_user_request_/resources

    # Resources on Tatooine with OQ >= 800:
    curl "${var.localstack_endpoint}/restapis/${aws_api_gateway_rest_api.swg_api.id}/${aws_api_gateway_stage.dev.stage_name}/_user_request_/resources?planet=Tatooine&stat=oq&min=800"

    # Today's events:
    curl ${var.localstack_endpoint}/restapis/${aws_api_gateway_rest_api.swg_api.id}/${aws_api_gateway_stage.dev.stage_name}/_user_request_/events

    # List alert rules:
    curl ${var.localstack_endpoint}/restapis/${aws_api_gateway_rest_api.swg_api.id}/${aws_api_gateway_stage.dev.stage_name}/_user_request_/alerts/rules

    # Create an alert rule:
    curl -X POST -H "Content-Type: application/json" -d '{"name":"Good Copper","classPattern":"Copper","stat":"oq","minValue":800}' ${var.localstack_endpoint}/restapis/${aws_api_gateway_rest_api.swg_api.id}/${aws_api_gateway_stage.dev.stage_name}/_user_request_/alerts/rules
  EOT
}
