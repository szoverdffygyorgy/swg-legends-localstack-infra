# OpenTofu configuration for LocalStack.
#
# This file does two things:
# 1. Declares which "provider" we need (AWS)
# 2. Configures that provider to talk to LocalStack instead of real AWS
#
# A "provider" in OpenTofu is a plugin that knows how to talk to a
# specific API. The AWS provider knows how to create S3 buckets, DynamoDB
# tables, Lambda functions, etc. Normally it talks to aws.amazon.com --
# we redirect it to localhost:4566.

# ─── Required providers ────────────────────────────────────────────────
# This block tells OpenTofu: "I need the AWS provider. Go download it
# from the OpenTofu registry." You run `tofu init` once to fetch it.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ─── AWS provider configuration ───────────────────────────────────────
# In real AWS, you'd just set region and let the SDK find credentials
# from environment variables or ~/.aws/credentials. For LocalStack, we
# need to override every endpoint to point at localhost:4566.
#
# The dummy credentials ("test"/"test") are required by the SDK but
# ignored by LocalStack -- it doesn't do real IAM authentication.

provider "aws" {
  region     = var.aws_region
  access_key = "test"
  secret_key = "test"

  # Skip AWS-specific validation that would fail against LocalStack.
  # These are all "I know this isn't real AWS, don't check" flags.
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  # Point all AWS service endpoints at LocalStack's single gateway.
  # In real AWS, S3 is at s3.amazonaws.com, DynamoDB is at
  # dynamodb.amazonaws.com, etc. LocalStack serves them all on one port.
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

  # Force S3 to use path-style URLs: http://localhost:4566/bucket-name
  # instead of http://bucket-name.localhost:4566 (virtual-hosted style).
  # Real AWS prefers virtual-hosted, but LocalStack needs path-style
  # because DNS for *.localhost doesn't resolve.
  s3_use_path_style = true
}

