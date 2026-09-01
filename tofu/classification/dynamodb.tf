# DynamoDB table for the SWG resource class hierarchy.
#
# Stores the complete resource class tree (816 nodes) with parent-child
# relationships, materialized paths, and stat caps (min/max per stat).
#
# Access patterns:
#   1. Get a specific class by ID            -> primary key lookup
#   2. Get direct children of a class        -> GSI by-parent
#   3. Get all descendants of a class        -> GSI by-path with begins_with
#      e.g., "all Metals" = begins_with(treePath, "inorganic/mineral/metal")
#
# The by-path GSI uses a fixed partition key ("CLASS") so that all nodes
# share one partition. This enables begins_with queries across the entire
# tree. At 816 items this is fine -- the hot partition anti-pattern only
# matters at scale with high throughput demands.

# ─── Resource classes table ───────────────────────────────────────────
# One item per resource class node (both branch and leaf).
#
# Primary key: classId (e.g., "desh_copper")
# This is a slugified version of the class name, unique across all 816
# nodes. No sort key needed -- each class is a unique item.

resource "aws_dynamodb_table" "resource_classes" {
  name         = "resource-classes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "classId"

  # Primary key: slugified class name (e.g., "desh_copper")
  attribute {
    name = "classId"
    type = "S"
  }

  # Used as partition key for by-parent GSI
  attribute {
    name = "parentClassId"
    type = "S"
  }

  # Used as sort key for by-parent GSI
  attribute {
    name = "className"
    type = "S"
  }

  # Fixed partition key for by-path GSI (always "CLASS")
  attribute {
    name = "pk"
    type = "S"
  }

  # Materialized path for hierarchical queries
  attribute {
    name = "treePath"
    type = "S"
  }

  # GSI: query direct children of a class
  # "What resource types are under Copper?" -> parentClassId = "copper"
  # Sort by className for alphabetical ordering.
  global_secondary_index {
    name            = "by-parent"
    hash_key        = "parentClassId"
    range_key       = "className"
    projection_type = "ALL"
  }

  # GSI: query subtree by materialized path prefix
  # "All Metals" -> pk = "CLASS", begins_with(treePath, "inorganic/mineral/metal")
  # Fixed partition key groups all 816 nodes together for cross-tree queries.
  global_secondary_index {
    name            = "by-path"
    hash_key        = "pk"
    range_key       = "treePath"
    projection_type = "ALL"
  }

  tags = {
    Project = "swg-legends"
    Module  = "classification"
    Purpose = "Resource class hierarchy and stat caps"
  }
}
