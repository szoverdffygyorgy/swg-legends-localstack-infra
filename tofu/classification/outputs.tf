# Outputs for the classification module.
#
# These values can be read by other modules or scripts via:
#   tofu -chdir=tofu/classification output -raw table_name

output "table_name" {
  description = "Name of the resource-classes DynamoDB table"
  value       = aws_dynamodb_table.resource_classes.name
}

output "table_arn" {
  description = "ARN of the resource-classes DynamoDB table"
  value       = aws_dynamodb_table.resource_classes.arn
}
