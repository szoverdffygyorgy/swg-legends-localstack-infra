# Outputs for the schematics module.
#
# These values can be read by other modules or scripts via:
#   tofu -chdir=tofu/schematics output -raw table_name

output "table_name" {
  description = "Name of the schematics DynamoDB table"
  value       = aws_dynamodb_table.schematics.name
}

output "table_arn" {
  description = "ARN of the schematics DynamoDB table"
  value       = aws_dynamodb_table.schematics.arn
}
