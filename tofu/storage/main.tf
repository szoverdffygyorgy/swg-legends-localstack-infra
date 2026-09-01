# Storage OpenTofu configuration.
#
# Each module has its own directory and state file. This means:
# - `tofu apply` in storage/ only affects storage resources
# - `tofu destroy` in storage/ won't touch other modules
# - Each module can be managed independently
#
# The downside: we repeat the provider config. In a real project, you'd
# use Terraform workspaces or a shared backend to avoid this. For learning,
# explicit repetition makes the config self-contained and clear.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "localstack_endpoint" {
  description = "LocalStack gateway URL"
  type        = string
  default     = "http://localhost:4566"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

provider "aws" {
  region     = var.aws_region
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    s3             = var.localstack_endpoint
    dynamodb       = var.localstack_endpoint
    sqs            = var.localstack_endpoint
    sns            = var.localstack_endpoint
    lambda         = var.localstack_endpoint
    iam            = var.localstack_endpoint
    sts            = var.localstack_endpoint
    apigateway     = var.localstack_endpoint
    cloudwatch     = var.localstack_endpoint
    cloudwatchlogs = var.localstack_endpoint
    stepfunctions  = var.localstack_endpoint
    events         = var.localstack_endpoint
  }

  s3_use_path_style = true
}
