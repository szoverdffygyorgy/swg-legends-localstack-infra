# Phase 2 DynamoDB tables: event logging and alert rules.
#
# These two tables support the event-driven messaging system:
# - event-log: records every spawn/despawn event (the complete history)
# - alert-rules: stores user-defined alert conditions + fired alert history

# ─── Event Log table ──────────────────────────────────────────────────
# Records every resource spawn and despawn event.
#
# Partition key: date (e.g., "2026-08-31")
#   Grouping by date means "show me everything that happened today"
#   is a single, fast query. Each day is its own partition.
#
# Sort key: timestamp#resourceId (e.g., "2026-08-31T14:00:00Z#1741089")
#   Sorting by timestamp means events within a day are ordered
#   chronologically. Adding resourceId ensures uniqueness (two events
#   could theoretically have the same timestamp).

resource "aws_dynamodb_table" "event_log" {
  name         = "event-log"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "date"
  range_key    = "sk"

  attribute {
    name = "date"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S" # Format: "timestamp#resourceId"
  }

  tags = {
    Project = "swg-legends"
    Phase   = "2"
    Purpose = "Log of all resource spawn/despawn events"
  }
}

# ─── Alert Rules table ────────────────────────────────────────────────
# Stores two types of items in one table using a pk/sk pattern:
#
# 1. Alert rules (pk="RULE", sk=ruleId):
#    { pk: "RULE", sk: "r_001", name: "Good Copper", classPattern: "Copper",
#      stat: "oq", minValue: 900, enabled: true }
#
# 2. Fired alerts (pk="FIRED", sk="timestamp#ruleId"):
#    { pk: "FIRED", sk: "2026-08-31T14:00:00Z#r_001", ruleId: "r_001",
#      ruleName: "Good Copper", resourceName: "Epodura", ... }
#
# This is a common DynamoDB "single-table" pattern for related but
# different item types. The pk separates them cleanly:
# - Query pk="RULE" -> get all rules
# - Query pk="FIRED" -> get all fired alerts (sorted by time)

resource "aws_dynamodb_table" "alert_rules" {
  name         = "alert-rules"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  tags = {
    Project = "swg-legends"
    Phase   = "2"
    Purpose = "Alert rules and fired alert history"
  }
}
