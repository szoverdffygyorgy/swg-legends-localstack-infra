# SNS (Simple Notification Service) topics for resource events.
#
# SNS is a pub/sub messaging service. You "publish" a message to a topic,
# and all "subscribers" receive a copy. This is the fan-out pattern:
# one event, multiple consumers.
#
# We create two topics:
# - resource-spawned: a new resource appeared in the game
# - resource-despawned: a resource disappeared from the game
#
# Why separate topics instead of one "resource-changed" topic?
# Different consumers care about different events:
# - The alert evaluator only cares about spawns (new resources to check)
# - The history recorder only cares about despawns (resources to archive)
# Separate topics let each consumer subscribe only to what it needs,
# reducing unnecessary message processing.

resource "aws_sns_topic" "resource_spawned" {
  name = "resource-spawned"

  tags = {
    Project = "swg-legends"
    Module  = "messaging"
    Purpose = "Notify when a new resource spawns"
  }
}

resource "aws_sns_topic" "resource_despawned" {
  name = "resource-despawned"

  tags = {
    Project = "swg-legends"
    Module  = "messaging"
    Purpose = "Notify when a resource despawns"
  }
}
