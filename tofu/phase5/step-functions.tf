# Step Functions state machine: SWG Legends Ingestion Pipeline
#
# ┌─────────────────────────────────────────────────────────────┐
# │  What is Step Functions?                                     │
# │                                                             │
# │  A workflow orchestrator. You define a state machine -- a   │
# │  series of steps with transitions between them -- and AWS   │
# │  executes it. Each step can invoke a Lambda, make a         │
# │  decision, run branches in parallel, or wait.               │
# │                                                             │
# │  The state machine is defined in Amazon States Language     │
# │  (ASL), a JSON-based DSL. Each state has:                   │
# │    - Type: Task, Choice, Parallel, Pass, Wait, Succeed, Fail│
# │    - Next: which state to go to after this one              │
# │    - Retry/Catch: error handling policies                   │
# │                                                             │
# │  Why not just chain Lambdas in code?                        │
# │    - Visibility: you can see exactly where an execution is  │
# │    - Retries: automatic retry with backoff, per step        │
# │    - Partial failures: if step 4 fails, steps 1-3 aren't   │
# │      re-run. You can fix the issue and restart from step 4  │
# │    - Audit trail: every execution is logged with inputs,    │
# │      outputs, and duration per step                         │
# │    - Parallel execution: run independent steps concurrently │
# └─────────────────────────────────────────────────────────────┘
#
# Our pipeline state machine:
#
#   Download → Parse → Diff → Choice(hasChanges?)
#                               ├─ Yes → UpdateDB → Parallel(LogEvents, PublishSNS) → Archive
#                               └─ No  → Archive
#

resource "aws_sfn_state_machine" "ingestion_pipeline" {
  name     = "swg-legends-ingestion-pipeline"
  role_arn = aws_iam_role.sfn_execution.arn

  definition = jsonencode({
    Comment = "SWG Legends resource ingestion pipeline"
    StartAt = "DownloadExport"

    States = {
      # ─── Step 1: Download ─────────────────────────────────────
      DownloadExport = {
        Type     = "Task"
        Resource = aws_lambda_function.pipeline_download.arn
        Comment  = "Download SWGAide XML export and upload to S3"
        Next     = "ParseXML"

        # If download fails (network issue), retry up to 3 times
        # with exponential backoff: 2s, 4s, 8s
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2.0
          }
        ]

        # If all retries fail, go to the failure state
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "PipelineFailed"
            ResultPath  = "$.error"
          }
        ]
      }

      # ─── Step 2: Parse ────────────────────────────────────────
      ParseXML = {
        Type     = "Task"
        Resource = aws_lambda_function.pipeline_parse.arn
        Comment  = "Parse XML into SWGResource objects, write to S3"
        Next     = "DiffResources"

        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2.0
          }
        ]

        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "PipelineFailed"
            ResultPath  = "$.error"
          }
        ]
      }

      # ─── Step 3: Diff ─────────────────────────────────────────
      DiffResources = {
        Type     = "Task"
        Resource = aws_lambda_function.pipeline_diff.arn
        Comment  = "Compare parsed resources against DynamoDB"
        Next     = "HasChanges"

        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2.0
          }
        ]

        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "PipelineFailed"
            ResultPath  = "$.error"
          }
        ]
      }

      # ─── Choice: any changes? ──────────────────────────────────
      # This is a Choice state -- it evaluates a condition on the
      # input data and branches accordingly. No Lambda runs here;
      # it's pure routing logic inside the state machine.
      HasChanges = {
        Type    = "Choice"
        Comment = "If no spawns or despawns, skip to archive"

        Choices = [
          {
            Variable      = "$.hasChanges"
            BooleanEquals = true
            Next          = "UpdateDynamoDB"
          }
        ]

        # Default: no changes, skip straight to archive
        Default = "ArchiveToS3"
      }

      # ─── Step 4: Update DynamoDB ──────────────────────────────
      UpdateDynamoDB = {
        Type     = "Task"
        Resource = aws_lambda_function.pipeline_update_db.arn
        Comment  = "Add spawned resources, remove despawned from DynamoDB"
        Next     = "LogAndPublish"

        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 3
            BackoffRate     = 2.0
          }
        ]

        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "PipelineFailed"
            ResultPath  = "$.error"
          }
        ]
      }

      # ─── Step 5: Parallel (Log + Publish) ─────────────────────
      # A Parallel state runs multiple branches simultaneously.
      # LogEvents and PublishSNS are independent -- neither needs
      # the other's output. Running them in parallel saves time.
      #
      # The Parallel state waits for ALL branches to complete
      # before moving to the next state.
      #
      # ResultPath stores the branch outputs inside the original
      # state data so ArchiveToS3 can still access xmlS3Key.
      LogAndPublish = {
        Type    = "Parallel"
        Comment = "Log events and publish to SNS in parallel"
        Next    = "ArchiveToS3"
        ResultPath = "$.parallelResults"

        # The input to each branch is the same (the current state data).
        # Each branch's output is collected into an array.
        Branches = [
          {
            StartAt = "LogEvents"
            States = {
              LogEvents = {
                Type     = "Task"
                Resource = aws_lambda_function.pipeline_log_events.arn
                End      = true

                Retry = [
                  {
                    ErrorEquals     = ["States.ALL"]
                    IntervalSeconds = 2
                    MaxAttempts     = 2
                    BackoffRate     = 2.0
                  }
                ]
              }
            }
          },
          {
            StartAt = "PublishSNS"
            States = {
              PublishSNS = {
                Type     = "Task"
                Resource = aws_lambda_function.pipeline_publish_sns.arn
                End      = true

                Retry = [
                  {
                    ErrorEquals     = ["States.ALL"]
                    IntervalSeconds = 2
                    MaxAttempts     = 2
                    BackoffRate     = 2.0
                  }
                ]
              }
            }
          }
        ]

        # If either branch fails after retries, catch and fail gracefully
        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "PipelineFailed"
            ResultPath  = "$.error"
          }
        ]
      }

      # ─── Step 6: Archive ──────────────────────────────────────
      ArchiveToS3 = {
        Type     = "Task"
        Resource = aws_lambda_function.pipeline_archive.arn
        Comment  = "Archive raw XML to permanent S3 path and clean up temp files"
        Next     = "PipelineSucceeded"

        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 2
            MaxAttempts     = 2
            BackoffRate     = 2.0
          }
        ]

        Catch = [
          {
            ErrorEquals = ["States.ALL"]
            Next        = "PipelineFailed"
            ResultPath  = "$.error"
          }
        ]
      }

      # ─── Terminal states ──────────────────────────────────────
      PipelineSucceeded = {
        Type    = "Succeed"
        Comment = "Pipeline completed successfully"
      }

      PipelineFailed = {
        Type    = "Fail"
        Comment = "Pipeline failed after retries"
        Cause   = "A pipeline step failed after all retry attempts"
        Error   = "PipelineExecutionFailed"
      }
    }
  })

  tags = {
    Project = "swg-legends"
    Phase   = "5"
    Purpose = "Ingestion pipeline orchestration"
  }
}
