# DynamoDB table for SWG crafting schematics.
#
# Single-table design with two item types:
#
#   pk = "SCHEM#{id}", sk = "META"
#     Schematic metadata: name, base, category, ingredients, exp groups.
#
#   pk = "CLASS#{className}", sk = "SCHEM#{id}"
#     Ingredient reverse index. One item per resource class per schematic.
#     Enables: "find all schematics that use Copper" -> pk = "CLASS#Copper"
#
# Access patterns:
#   1. Get schematic by ID         -> pk = "SCHEM#1717", sk = "META"
#   2. Find schematics by class    -> pk = "CLASS#Metal"
#   3. Browse by category          -> GSI by-category: category + name
#   4. List/search by name         -> GSI by-category scan with filter
#                                     (3,673 items -- scan is fine at this scale)

resource "aws_dynamodb_table" "schematics" {
  name         = "schematics"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  # Primary key attributes
  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # GSI attributes
  attribute {
    name = "category"
    type = "S"
  }

  attribute {
    name = "name"
    type = "S"
  }

  # GSI: browse schematics by category
  # "What can I craft in category 767?" -> category = "767", sorted by name
  # Only SCHEM# items have category/name populated; CLASS# items are
  # excluded naturally (they don't have these attributes).
  global_secondary_index {
    name            = "by-category"
    hash_key        = "category"
    range_key       = "name"
    projection_type = "ALL"
  }

  tags = {
    Project = "swg-legends"
    Module  = "schematics"
    Purpose = "Crafting recipe data and ingredient index"
  }
}
