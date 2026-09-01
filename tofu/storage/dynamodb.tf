# DynamoDB tables for SWG Legends resource data.
#
# DynamoDB key design is the most important decision here. Unlike SQL
# databases where you design a normalized schema and query it any way
# you want with JOINs, DynamoDB requires you to know your access
# patterns UP FRONT and design keys around them.
#
# Our access patterns for the resources table:
#   1. Get a specific resource by ID         -> partition key lookup
#   2. All resources on a planet             -> GSI by-planet
#   3. All resources under a class hierarchy -> GSI by-category
#   4. Filter by stat thresholds             -> filter on any of the above
#
# What's a GSI (Global Secondary Index)?
# Think of it as a "second table" that DynamoDB maintains automatically.
# When you write to the main table, DynamoDB copies the data into each
# GSI, re-organized by that GSI's key. This lets you query the same data
# by different keys without maintaining separate tables yourself.
# Tradeoff: writes are slightly more expensive (each GSI is an extra write),
# but reads are fast and simple.

# ─── Resources table ──────────────────────────────────────────────────
# Stores current resource spawns. One item per resource-planet combination.
#
# For a resource on 3 planets, we store 3 items (denormalized).
# Why? Because DynamoDB has no JOINs. If we stored planets as a list
# attribute, we couldn't query "all resources on Tatooine" efficiently.
# Denormalization = duplicate data to enable fast queries.
#
# Primary key: resourceId (partition) + planet (sort)
# - This combo is unique (a resource can only be on each planet once)
# - Lets us get all planets for a resource with a single query
#
# GSI by-planet: planet (partition) + resourceClass (sort)
# - "Show me all Reactive Gas resources on Mustafar"
#
# GSI by-category: classCategory (partition) + classPath (sort)
# - "Show me all Metal resources" via begins_with on classPath
# - Partitioned by top-level category (Inorganic, Organic, Energy, Space Resource)
#   to distribute items across partitions

resource "aws_dynamodb_table" "resources" {
  name         = "resources"
  billing_mode = "PAY_PER_REQUEST" # No capacity planning needed (good for dev)
  hash_key     = "resourceId"
  range_key    = "planet"

  # Partition key: the SWGAide resource ID (e.g., "1741089")
  attribute {
    name = "resourceId"
    type = "S" # S = String
  }

  # Sort key: planet name (e.g., "Tatooine")
  attribute {
    name = "planet"
    type = "S"
  }

  # Used as sort key in the by-planet GSI
  attribute {
    name = "resourceClass"
    type = "S"
  }

  # Used as partition key in the by-category GSI
  # Top-level category: "Inorganic", "Organic", "Energy", "Space Resource"
  attribute {
    name = "classCategory"
    type = "S"
  }

  # Used as sort key in the by-category GSI
  # Materialized hierarchy path, e.g., "inorganic/mineral/metal/non-ferrous_metal/copper/desh_copper"
  attribute {
    name = "classPath"
    type = "S"
  }

  # GSI: query by planet
  # "All resources on Tatooine" -> query this index with planet = "Tatooine"
  # Sort by resourceClass so results are grouped by type
  global_secondary_index {
    name            = "by-planet"
    hash_key        = "planet"
    range_key       = "resourceClass"
    projection_type = "ALL" # Copy all attributes into the index
  }

  # GSI: query by class hierarchy
  # "All Metal resources" -> classCategory = "Inorganic",
  #   begins_with(classPath, "inorganic/mineral/metal/")
  # Partitioned by top-level category so items are distributed across
  # DynamoDB partitions. The classPath sort key enables prefix queries
  # for any level of the hierarchy.
  global_secondary_index {
    name            = "by-category"
    hash_key        = "classCategory"
    range_key       = "classPath"
    projection_type = "ALL"
  }

  tags = {
    Project = "swg-legends"
    Module  = "storage"
    Purpose = "Current resource spawns"
  }
}

# ─── Resource history table ───────────────────────────────────────────
# Will store past resource spawns for trend analysis.
# Schema only for now -- we'll populate it in the messaging module when we build
# the diff engine that detects spawn/despawn events.
#
# Primary key: resourceId (partition) + despawnedAt (sort)
# - Partition by resource ID groups all history for one resource together
# - Sort by despawn timestamp lets us query "most recent despawns" or
#   "all spawns of resource X over time"

resource "aws_dynamodb_table" "resource_history" {
  name         = "resource-history"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "resourceId"
  range_key    = "despawnedAt"

  attribute {
    name = "resourceId"
    type = "S"
  }

  attribute {
    name = "despawnedAt"
    type = "S" # ISO 8601 string (e.g., "2026-08-31T12:00:00Z")
  }

  tags = {
    Project = "swg-legends"
    Module  = "storage"
    Purpose = "Historical resource spawn data"
  }
}
