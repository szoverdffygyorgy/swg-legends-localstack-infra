# Classification OpenTofu configuration: Resource class hierarchy.
#
# This module manages the resource class reference data -- SWG's
# deep hierarchy of resource types (e.g., Inorganic > Mineral > Metal
# > Non-Ferrous Metal > Copper > Desh Copper) along with stat caps
# (min/max values) for each class.
#
# This is static game data that rarely changes. It's scraped once from
# SWGAide (scripts/scrape-resource-tree.ts) and seeded into DynamoDB
# (scripts/seed-resource-classes.ts). Other modules query this table
# to enrich resources with hierarchy information.
#
# Independent state: `tofu apply` here only affects classification
# resources. `tofu destroy` won't touch other modules.

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
