/**
 * Contact form: CloudFront -> API Gateway -> Lambda -> SES.
 *
 * The form posts to `/api/contact` on the site's own domain, not to a separate API
 * hostname. That is deliberate: a same-origin POST needs no CORS preflight, no custom
 * domain, no second certificate, and the action attribute is a stable path known at build
 * time rather than a URL that only exists after apply.
 *
 * SES SANDBOX: a new account can only send *to* verified addresses. That is fine here,
 * because the only recipient is the site's own inbox — which is verified below. Sending to
 * arbitrary addresses would require a production-access request to AWS support, and nothing
 * here needs it.
 */

variable "contact_to" {
  description = "Address that receives contact form submissions. Must be verified in SES."
  type        = string
}

# ---------------------------------------------------------------- SES

# Domain identity, so mail can be sent as anything@inevitablefrontier.org. DKIM records are
# published into the existing zone, which is what stops the mail being treated as spoofed.
resource "aws_ses_domain_identity" "site" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "site" {
  domain = aws_ses_domain_identity.site.domain
}

resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = data.aws_route53_zone.site.zone_id
  name    = "${aws_ses_domain_dkim.site.dkim_tokens[count.index]}._domainkey"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.site.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# The recipient. In the SES sandbox this address must confirm by email before anything can
# be delivered to it — AWS sends a verification link on apply.
resource "aws_ses_email_identity" "recipient" {
  email = var.contact_to
}

# ---------------------------------------------------------------- Lambda

data "archive_file" "contact" {
  type        = "zip"
  source_file = "${path.module}/lambda/contact.mjs"
  output_path = "${path.module}/.build/contact.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "contact" {
  name               = "${var.project}-contact"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "contact_logs" {
  role       = aws_iam_role.contact.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Send only, and only as this domain's verified identity — not blanket ses:* .
data "aws_iam_policy_document" "contact_ses" {
  statement {
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [aws_ses_domain_identity.site.arn]
  }
}

resource "aws_iam_role_policy" "contact_ses" {
  name   = "${var.project}-contact-ses"
  role   = aws_iam_role.contact.id
  policy = data.aws_iam_policy_document.contact_ses.json
}

resource "aws_lambda_function" "contact" {
  function_name    = "${var.project}-contact"
  role             = aws_iam_role.contact.arn
  handler          = "contact.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.contact.output_path
  source_code_hash = data.archive_file.contact.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      SITE_URL     = "https://${var.domain_name}"
      CONTACT_TO   = var.contact_to
      CONTACT_FROM = "contact@${var.domain_name}"
    }
  }
}

# 14 days: long enough to debug a failed submission, short enough not to accumulate
# personal data indefinitely. Without this the group is created implicitly and never expires.
resource "aws_cloudwatch_log_group" "contact" {
  name              = "/aws/lambda/${aws_lambda_function.contact.function_name}"
  retention_in_days = 14
}

# ---------------------------------------------------------------- API Gateway

resource "aws_apigatewayv2_api" "contact" {
  name          = "${var.project}-contact"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "contact" {
  api_id                 = aws_apigatewayv2_api.contact.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.contact.invoke_arn
  payload_format_version = "2.0"
}

# The route path matches what CloudFront forwards. The /api/* behaviour passes the full
# path through, so the route is /api/contact rather than /contact.
resource "aws_apigatewayv2_route" "contact" {
  api_id    = aws_apigatewayv2_api.contact.id
  route_key = "POST /api/contact"
  target    = "integrations/${aws_apigatewayv2_integration.contact.id}"
}

resource "aws_apigatewayv2_stage" "contact" {
  api_id      = aws_apigatewayv2_api.contact.id
  name        = "$default"
  auto_deploy = true

  # 100 requests/second is far above any real load on a contact form and well below
  # anything that would produce a surprising bill.
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 100
  }
}

resource "aws_lambda_permission" "contact" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.contact.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.contact.execution_arn}/*/*"
}

output "contact_endpoint" {
  description = "Same-origin path the form posts to."
  value       = "https://${var.domain_name}/api/contact"
}
