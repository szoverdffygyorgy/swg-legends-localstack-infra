# Compute OpenTofu configuration: Lambda
#
# This module converts manual queue consumer scripts into auto-triggered
# Lambda functions. When a message arrives in SQS, Lambda automatically
# runs the handler function to process it.

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
