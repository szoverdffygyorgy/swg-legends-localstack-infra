# SQS -> Lambda event source mappings.
#
# This is the "glue" that makes Lambda auto-trigger when messages
# arrive in SQS. Without this, the Lambda functions exist but nothing
# invokes them.
#
# How it works:
# 1. AWS polls the SQS queue on your behalf (you don't write polling code)
# 2. When messages are available, AWS invokes your Lambda with a batch
# 3. If the Lambda returns successfully, AWS deletes the messages
# 4. If the Lambda throws an error, messages become visible again (retry)
# 5. After maxReceiveCount failures, messages go to the DLQ
#
# Key settings:
# - batch_size: how many messages per Lambda invocation (1-10 for standard queues)
# - enabled: you can disable the trigger without deleting it

# Reference the SQS queues from Phase 2 by their ARN.
# Since Phase 2 is in a separate OpenTofu state, we use data sources
# to look up the existing queues.

data "aws_sqs_queue" "alert_evaluator" {
  name = "alert-evaluator"
}

data "aws_sqs_queue" "history_recorder" {
  name = "history-recorder"
}

# ─── alert-evaluator SQS -> alert-evaluator Lambda ───────────────────

resource "aws_lambda_event_source_mapping" "alert_evaluator" {
  event_source_arn = data.aws_sqs_queue.alert_evaluator.arn
  function_name    = aws_lambda_function.alert_evaluator.arn
  enabled          = true

  # Process messages one at a time for simplicity.
  # In production, you might increase this for throughput,
  # but our Lambda code processes each record in a loop anyway.
  batch_size = 5
}

# ─── history-recorder SQS -> history-recorder Lambda ─────────────────

resource "aws_lambda_event_source_mapping" "history_recorder" {
  event_source_arn = data.aws_sqs_queue.history_recorder.arn
  function_name    = aws_lambda_function.history_recorder.arn
  enabled          = true

  batch_size = 5
}
