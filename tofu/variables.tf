# Shared variables used across all phases.
#
# Variables in OpenTofu are like function parameters: they let you change
# behavior without editing the main configuration. Each has a type, a
# description (for humans), and a default value.
#
# You can override defaults at runtime:
#   tofu apply -var="aws_region=eu-west-1"
# or via a .tfvars file:
#   tofu apply -var-file="custom.tfvars"
#
# For our LocalStack setup, the defaults are fine -- we never need to
# change them. But defining them as variables is good practice because
# in a real project, you'd have dev/staging/prod environments with
# different values.

variable "aws_region" {
  description = "AWS region (arbitrary for LocalStack, but SDK requires one)"
  type        = string
  default     = "us-east-1"
}

variable "localstack_endpoint" {
  description = "LocalStack gateway URL -- all AWS services are behind this single endpoint"
  type        = string
  default     = "http://localhost:4566"
}
