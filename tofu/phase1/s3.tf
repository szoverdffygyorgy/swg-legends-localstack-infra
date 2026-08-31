# S3 bucket for archiving raw SWGAide XML exports.
#
# Why S3 for this?
# - The XML exports are ~200KB gzipped, ~12K lines uncompressed.
#   Not huge, but they change with every download (resources spawn/despawn).
# - By archiving each download with a timestamp, we build a history of
#   the resource landscape over time.
# - S3 is cheap, durable storage for files you don't need to query directly.
#   You CAN'T say "find all resources with OQ > 900" against S3 -- that's
#   what DynamoDB is for. S3 just stores the raw files.
#
# Key structure in the bucket:
#   exports/
#     2026-08-31T12:00:00Z/
#       currentresources_138.xml      # raw XML snapshot
#     2026-08-31T12:30:00Z/
#       currentresources_138.xml      # next snapshot
#     ...

resource "aws_s3_bucket" "raw_exports" {
  bucket = "swg-legends-raw-exports"

  tags = {
    Project = "swg-legends"
    Phase   = "1"
    Purpose = "Archive raw SWGAide XML exports"
  }
}

# Enable versioning on the bucket.
# This means S3 keeps old versions of a file even if you overwrite it.
# In our case we use timestamped keys so we won't overwrite, but
# versioning is a safety net -- and it's good practice to learn about.
resource "aws_s3_bucket_versioning" "raw_exports" {
  bucket = aws_s3_bucket.raw_exports.id

  versioning_configuration {
    status = "Enabled"
  }
}
