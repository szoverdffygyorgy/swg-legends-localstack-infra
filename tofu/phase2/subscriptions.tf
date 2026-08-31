# SNS -> SQS subscriptions: the fan-out wiring.
#
# This is where we connect the broadcast (SNS) to the buffers (SQS).
# When a message is published to an SNS topic, SNS delivers a copy
# to every subscribed SQS queue.
#
# We also need to grant SNS permission to write to the SQS queues.
# In real AWS, this is a critical IAM/policy step -- without it,
# SNS would get "access denied" when trying to deliver messages.
# LocalStack is more lenient, but we set it up correctly for learning.

# ─── resource-despawned -> history-recorder ────────────────────────────

resource "aws_sns_topic_subscription" "despawned_to_history" {
  topic_arn = aws_sns_topic.resource_despawned.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.history_recorder.arn

  # Deliver the raw message body, not wrapped in SNS metadata.
  # Without this, the SQS message body would be a JSON envelope
  # containing the actual message nested inside. Raw delivery
  # means the consumer gets the message as-is.
  raw_message_delivery = true
}

# ─── resource-spawned -> alert-evaluator ──────────────────────────────

resource "aws_sns_topic_subscription" "spawned_to_alerts" {
  topic_arn = aws_sns_topic.resource_spawned.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.alert_evaluator.arn

  raw_message_delivery = true
}

# ─── SQS queue policies ──────────────────────────────────────────────
# Allow the SNS topics to send messages to the SQS queues.
# This is the "permission" side of the subscription.

resource "aws_sqs_queue_policy" "history_recorder_policy" {
  queue_url = aws_sqs_queue.history_recorder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSNSToSendMessage"
        Effect    = "Allow"
        Principal = { Service = "sns.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.history_recorder.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_sns_topic.resource_despawned.arn
          }
        }
      }
    ]
  })
}

resource "aws_sqs_queue_policy" "alert_evaluator_policy" {
  queue_url = aws_sqs_queue.alert_evaluator.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSNSToSendMessage"
        Effect    = "Allow"
        Principal = { Service = "sns.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.alert_evaluator.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_sns_topic.resource_spawned.arn
          }
        }
      }
    ]
  })
}
