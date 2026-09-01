# Frontend S3 static website hosting.
#
# ┌─────────────────────────────────────────────────────────────┐
# │  S3 Static Website Hosting                                  │
# │                                                             │
# │  S3 isn't just for storing files -- it can also serve them  │
# │  as a website. You enable "static website hosting" on a     │
# │  bucket, and S3 serves the files over HTTP with:            │
# │    - An index document (usually index.html)                 │
# │    - An error document (for SPAs, also index.html so that   │
# │      React Router can handle client-side routing)           │
# │    - Public read access via a bucket policy                 │
# │                                                             │
# │  This is how many production sites work:                    │
# │    - Build React app → static HTML/JS/CSS files             │
# │    - Upload to S3 → S3 serves them                          │
# │    - Add CloudFront (CDN) in front for caching + HTTPS      │
# │                                                             │
# │  Costs: ~$0.023/GB stored + $0.0004/1000 requests           │
# │  For our dashboard (~250KB), essentially free.              │
# └─────────────────────────────────────────────────────────────┘

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
    s3 = var.localstack_endpoint
  }

  s3_use_path_style = true
}

# ─── S3 bucket for frontend files ─────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket = "swg-legends-frontend"

  tags = {
    Project = "swg-legends"
    Purpose = "Frontend static website hosting"
  }
}

# ─── Website configuration ────────────────────────────────────────────
# Tells S3 to serve files as a website.
# index_document: served when you request "/" or any directory
# error_document: served for 404s -- set to index.html so React Router
# can handle client-side routes (e.g., /alerts returns index.html,
# then React Router renders the Alerts page)

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

# ─── Public access policy ─────────────────────────────────────────────
# Allow anyone to read files from the bucket (it's a public website).
# In production, you'd use CloudFront with an Origin Access Identity
# instead of making the bucket directly public.

resource "aws_s3_bucket_policy" "frontend_public" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
      }
    ]
  })
}

# ─── Outputs ──────────────────────────────────────────────────────────

output "bucket_name" {
  description = "Frontend S3 bucket name"
  value       = aws_s3_bucket.frontend.id
}

output "website_url" {
  description = "Frontend website URL (LocalStack format)"
  value       = "${var.localstack_endpoint}/${aws_s3_bucket.frontend.id}/index.html"
}
