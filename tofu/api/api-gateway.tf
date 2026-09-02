# API Gateway REST API (v1) configuration.
#
# ┌─────────────────────────────────────────────────────────────┐
# │  What is API Gateway?                                       │
# │                                                             │
# │  It's a managed HTTP router. You define routes like         │
# │  "GET /resources" and tell it which Lambda to call.         │
# │  API Gateway handles:                                       │
# │    - Accepting HTTP requests from browsers/clients          │
# │    - Routing to the correct Lambda based on path + method   │
# │    - Passing the request as a JSON event to Lambda          │
# │    - Returning Lambda's response as an HTTP response        │
# │    - CORS headers (so browsers allow cross-origin calls)    │
# │    - Throttling (rate limiting)                             │
# │                                                             │
# │  Without it, you'd need to run your own HTTP server         │
# │  (Express, Fastify, etc.) and handle routing, CORS,        │
# │  scaling, and availability yourself.                        │
# └─────────────────────────────────────────────────────────────┘
#
# We use REST API (v1) because LocalStack's free Hobby tier includes
# it but not HTTP API (v2). REST API is more verbose in OpenTofu but
# teaches more AWS concepts — each piece of the routing chain is
# explicit:
#
#   REST API → Resource (path) → Method (GET/POST) → Integration (→ Lambda)
#
# Then you create a Deployment and a Stage to make it live.
#
# Our route table:
#   GET    /resources              → api-get-resources Lambda
#   GET    /resources/{id}         → api-get-resources Lambda
#   GET    /events                 → api-get-events Lambda
#   GET    /alerts/rules           → api-alerts Lambda
#   POST   /alerts/rules           → api-alerts Lambda
#   DELETE /alerts/rules/{ruleId}  → api-alerts Lambda
#   GET    /alerts/history         → api-alerts Lambda
#   GET    /history                → api-get-history Lambda
#
# CORS is handled by each Lambda returning Access-Control-Allow-Origin
# headers, plus OPTIONS methods for preflight requests.

# ─── The API itself ──────────────────────────────────────────────────

resource "aws_api_gateway_rest_api" "swg_api" {
  name        = "swg-legends-api"
  description = "SWG Legends Crafting & Resource Intelligence API"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = {
    Project = "swg-legends"
    Module  = "api"
    Purpose = "REST API for resource intelligence"
  }
}

# ═══════════════════════════════════════════════════════════════════════
# RESOURCES (path segments)
# ═══════════════════════════════════════════════════════════════════════
# In REST API v1, every path segment needs an explicit "resource."
# The root "/" is provided automatically by the REST API.
# We build the tree:
#
#   / (root)
#   ├── /resources
#   │   └── /resources/{id}
#   ├── /events
#   └── /alerts
#       ├── /alerts/rules
#       │   └── /alerts/rules/{ruleId}
#       └── /alerts/history
#   └── /pipeline
#       └── /pipeline/status
#   └── /ops
#       └── /ops/dashboard
#   └── /history

resource "aws_api_gateway_resource" "resources" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_rest_api.swg_api.root_resource_id
  path_part   = "resources"
}

resource "aws_api_gateway_resource" "resource_by_id" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_resource.resources.id
  path_part   = "{id}"
}

resource "aws_api_gateway_resource" "events" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_rest_api.swg_api.root_resource_id
  path_part   = "events"
}

resource "aws_api_gateway_resource" "alerts" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_rest_api.swg_api.root_resource_id
  path_part   = "alerts"
}

resource "aws_api_gateway_resource" "alerts_rules" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_resource.alerts.id
  path_part   = "rules"
}

resource "aws_api_gateway_resource" "alerts_rules_by_id" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_resource.alerts_rules.id
  path_part   = "{ruleId}"
}

resource "aws_api_gateway_resource" "alerts_history" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_resource.alerts.id
  path_part   = "history"
}

resource "aws_api_gateway_resource" "pipeline" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_rest_api.swg_api.root_resource_id
  path_part   = "pipeline"
}

resource "aws_api_gateway_resource" "pipeline_status" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_resource.pipeline.id
  path_part   = "status"
}

resource "aws_api_gateway_resource" "ops" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_rest_api.swg_api.root_resource_id
  path_part   = "ops"
}

resource "aws_api_gateway_resource" "ops_dashboard" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_resource.ops.id
  path_part   = "dashboard"
}

resource "aws_api_gateway_resource" "history" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id
  parent_id   = aws_api_gateway_rest_api.swg_api.root_resource_id
  path_part   = "history"
}

# ═══════════════════════════════════════════════════════════════════════
# METHODS + INTEGRATIONS
# ═══════════════════════════════════════════════════════════════════════
# Each endpoint needs:
# 1. A METHOD — defines the HTTP verb (GET, POST, DELETE) and auth type
# 2. An INTEGRATION — connects the method to a Lambda function
#
# We use "AWS_PROXY" integration type. This is "Lambda Proxy Integration":
# API Gateway passes the full HTTP request to Lambda as JSON, and Lambda
# returns a full HTTP response (status, headers, body). No transformation.
#
# The integration_http_method is always POST — that's the method API
# Gateway uses to *invoke* the Lambda (not the client's HTTP method).

# ─── GET /resources ───────────────────────────────────────────────────

resource "aws_api_gateway_method" "get_resources" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.resources.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_resources" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.resources.id
  http_method             = aws_api_gateway_method.get_resources.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_get_resources.invoke_arn
}

# ─── GET /resources/{id} ─────────────────────────────────────────────

resource "aws_api_gateway_method" "get_resource_by_id" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.resource_by_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_resource_by_id" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.resource_by_id.id
  http_method             = aws_api_gateway_method.get_resource_by_id.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_get_resources.invoke_arn
}

# ─── GET /events ──────────────────────────────────────────────────────

resource "aws_api_gateway_method" "get_events" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.events.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_events" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.events.id
  http_method             = aws_api_gateway_method.get_events.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_get_events.invoke_arn
}

# ─── GET /alerts/rules ────────────────────────────────────────────────

resource "aws_api_gateway_method" "get_alert_rules" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.alerts_rules.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_alert_rules" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.alerts_rules.id
  http_method             = aws_api_gateway_method.get_alert_rules.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_alerts.invoke_arn
}

# ─── POST /alerts/rules ──────────────────────────────────────────────

resource "aws_api_gateway_method" "create_alert_rule" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.alerts_rules.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "create_alert_rule" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.alerts_rules.id
  http_method             = aws_api_gateway_method.create_alert_rule.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_alerts.invoke_arn
}

# ─── DELETE /alerts/rules/{ruleId} ────────────────────────────────────

resource "aws_api_gateway_method" "delete_alert_rule" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.alerts_rules_by_id.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "delete_alert_rule" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.alerts_rules_by_id.id
  http_method             = aws_api_gateway_method.delete_alert_rule.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_alerts.invoke_arn
}

# ─── GET /alerts/history ──────────────────────────────────────────────

resource "aws_api_gateway_method" "get_alert_history" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.alerts_history.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_alert_history" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.alerts_history.id
  http_method             = aws_api_gateway_method.get_alert_history.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_alerts.invoke_arn
}

# ─── GET /pipeline/status ─────────────────────────────────────────────

resource "aws_api_gateway_method" "get_pipeline_status" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.pipeline_status.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_pipeline_status" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.pipeline_status.id
  http_method             = aws_api_gateway_method.get_pipeline_status.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_pipeline_status.invoke_arn
}

# ─── GET /ops/dashboard ───────────────────────────────────────────────

resource "aws_api_gateway_method" "get_ops_dashboard" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.ops_dashboard.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_ops_dashboard" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.ops_dashboard.id
  http_method             = aws_api_gateway_method.get_ops_dashboard.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_ops_dashboard.invoke_arn
}

# ─── GET /history ─────────────────────────────────────────────────────

resource "aws_api_gateway_method" "get_history" {
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  resource_id   = aws_api_gateway_resource.history.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_history" {
  rest_api_id             = aws_api_gateway_rest_api.swg_api.id
  resource_id             = aws_api_gateway_resource.history.id
  http_method             = aws_api_gateway_method.get_history.http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api_get_history.invoke_arn
}

# ═══════════════════════════════════════════════════════════════════════
# DEPLOYMENT + STAGE
# ═══════════════════════════════════════════════════════════════════════
# In REST API v1, changes to routes/methods/integrations don't go live
# until you create a "deployment." A deployment is a snapshot of the API
# configuration. A "stage" (like "dev" or "prod") points to a deployment.
#
# The depends_on list ensures all methods and integrations are created
# before the deployment. Without this, OpenTofu might try to deploy
# before the routes exist.

resource "aws_api_gateway_deployment" "swg_api" {
  rest_api_id = aws_api_gateway_rest_api.swg_api.id

  # Force redeployment when any integration changes.
  # The triggers block computes a hash; if any value changes, the
  # deployment is recreated.
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.resources.id,
      aws_api_gateway_resource.resource_by_id.id,
      aws_api_gateway_resource.events.id,
      aws_api_gateway_resource.alerts_rules.id,
      aws_api_gateway_resource.alerts_rules_by_id.id,
      aws_api_gateway_resource.alerts_history.id,
      aws_api_gateway_method.get_resources.id,
      aws_api_gateway_method.get_resource_by_id.id,
      aws_api_gateway_method.get_events.id,
      aws_api_gateway_method.get_alert_rules.id,
      aws_api_gateway_method.create_alert_rule.id,
      aws_api_gateway_method.delete_alert_rule.id,
      aws_api_gateway_method.get_alert_history.id,
      aws_api_gateway_integration.get_resources.id,
      aws_api_gateway_integration.get_resource_by_id.id,
      aws_api_gateway_integration.get_events.id,
      aws_api_gateway_integration.get_alert_rules.id,
      aws_api_gateway_integration.create_alert_rule.id,
      aws_api_gateway_integration.delete_alert_rule.id,
      aws_api_gateway_integration.get_alert_history.id,
      aws_api_gateway_resource.pipeline.id,
      aws_api_gateway_resource.pipeline_status.id,
      aws_api_gateway_method.get_pipeline_status.id,
      aws_api_gateway_integration.get_pipeline_status.id,
      aws_api_gateway_resource.ops.id,
      aws_api_gateway_resource.ops_dashboard.id,
      aws_api_gateway_method.get_ops_dashboard.id,
      aws_api_gateway_integration.get_ops_dashboard.id,
      aws_api_gateway_resource.history.id,
      aws_api_gateway_method.get_history.id,
      aws_api_gateway_integration.get_history.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "dev" {
  deployment_id = aws_api_gateway_deployment.swg_api.id
  rest_api_id   = aws_api_gateway_rest_api.swg_api.id
  stage_name    = "dev"

  tags = {
    Project = "swg-legends"
    Module  = "api"
  }
}

# ═══════════════════════════════════════════════════════════════════════
# LAMBDA PERMISSIONS
# ═══════════════════════════════════════════════════════════════════════
# API Gateway needs explicit IAM permission to invoke each Lambda.
# Without this, every API call would get 500 Internal Server Error.

resource "aws_lambda_permission" "apigw_get_resources" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_get_resources.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.swg_api.execution_arn}/*"
}

resource "aws_lambda_permission" "apigw_get_events" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_get_events.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.swg_api.execution_arn}/*"
}

resource "aws_lambda_permission" "apigw_alerts" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_alerts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.swg_api.execution_arn}/*"
}

resource "aws_lambda_permission" "apigw_pipeline_status" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_pipeline_status.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.swg_api.execution_arn}/*"
}

resource "aws_lambda_permission" "apigw_ops_dashboard" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_ops_dashboard.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.swg_api.execution_arn}/*"
}

resource "aws_lambda_permission" "apigw_get_history" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_get_history.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.swg_api.execution_arn}/*"
}
