# SQS (Simple Queue Service) queues for processing resource events.
#
# SQS is a message queue: producers put messages in, consumers take
# messages out. Unlike SNS (which broadcasts instantly), SQS holds
# messages until a consumer explicitly reads and deletes them.
#
# Why SQS if we already have SNS?
# SNS delivers messages instantly but doesn't guarantee processing.
# If your consumer is down when SNS publishes, the message is lost.
# SQS acts as a buffer: SNS delivers to SQS, and the message waits
# in the queue until a consumer is ready to process it.
#
# The pattern: SNS (broadcast) -> SQS (buffer) -> Consumer (process)
#
# Each queue has a Dead Letter Queue (DLQ):
# If a message fails processing N times (maxReceiveCount), SQS
# automatically moves it to the DLQ instead of retrying forever.
# This prevents "poison messages" from blocking the queue.

# ─── Dead Letter Queues ───────────────────────────────────────────────
# DLQs must be created BEFORE the main queues (since main queues
# reference them in their redrive policy).

resource "aws_sqs_queue" "history_recorder_dlq" {
  name = "history-recorder-dlq"

  # Messages in the DLQ are kept for 14 days (max) before expiring.
  # This gives you time to investigate and reprocess failed messages.
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Project = "swg-legends"
    Phase   = "2"
    Purpose = "Dead letter queue for failed history recording"
  }
}

resource "aws_sqs_queue" "alert_evaluator_dlq" {
  name = "alert-evaluator-dlq"

  message_retention_seconds = 1209600

  tags = {
    Project = "swg-legends"
    Phase   = "2"
    Purpose = "Dead letter queue for failed alert evaluation"
  }
}

# ─── Main Queues ──────────────────────────────────────────────────────

resource "aws_sqs_queue" "history_recorder" {
  name = "history-recorder"

  # How long a consumer has to process a message before it becomes
  # visible again (for retry). 30 seconds is generous for our use case.
  visibility_timeout_seconds = 30

  # How long to wait for messages when polling (long polling).
  # 20 seconds is the max and is recommended -- it reduces empty
  # responses and API costs compared to short polling.
  receive_wait_time_seconds = 5

  # Redrive policy: after 3 failed attempts, move to the DLQ.
  # "Failed attempt" = consumer receives the message but doesn't
  # delete it within the visibility timeout (meaning processing failed).
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.history_recorder_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Project = "swg-legends"
    Phase   = "2"
    Purpose = "Process despawn events, write to resource-history table"
  }
}

resource "aws_sqs_queue" "alert_evaluator" {
  name = "alert-evaluator"

  visibility_timeout_seconds = 30
  receive_wait_time_seconds  = 5

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.alert_evaluator_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Project = "swg-legends"
    Phase   = "2"
    Purpose = "Process spawn events, evaluate alert rules"
  }
}
