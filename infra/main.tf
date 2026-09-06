/**
 * Static hosting: S3 behind CloudFront, via Origin Access Control.
 *
 * The site is three files totalling ~90 kB gzipped, generated entirely in the browser —
 * no server, no API, no image assets. See docs/plans/deploy-aws.md for why every option
 * involving a running instance costs more for no benefit.
 *
 * Expected cost: $0/month. CloudFront's perpetual free tier covers 1 TB egress, which at
 * this payload is on the order of ten million visits. A custom domain would add a Route 53
 * hosted zone at $0.50/month and is deliberately not configured here.
 */

# The bucket name has to be globally unique across all of AWS, so it carries a random
# suffix rather than being a name that might already be taken by a stranger.
resource "random_id" "suffix" {
  byte_length = 4
}

locals {
  bucket_name = "${var.project}-site-${random_id.suffix.hex}"
}

resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name
}

# The bucket is never public. CloudFront reaches it through OAC and nothing else can.
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    # Cheap insurance: a bad `s3 sync --delete` is otherwise unrecoverable, and the whole
    # bucket is under a megabyte.
    status = "Enabled"
  }
}

# OAC, not the deprecated OAI.
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS-managed policies, looked up rather than hardcoded as opaque UUIDs.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Forwards the viewer's headers, cookies and query string to the API, minus Host — which
# must stay the origin's own or API Gateway rejects the request.
data "aws_cloudfront_origin_request_policy" "api" {
  name = "Managed-AllViewerExceptHostHeader"
}

/**
 * Directory-index rewriting at the edge.
 *
 * CloudFront's `default_root_object` applies to `/` and nothing else. With an S3 REST
 * origin behind origin access control there is no directory-index behaviour at all, so
 * `/writing/` asks S3 for a key that does not exist and gets 403 — not even a 404, because
 * the bucket policy denies ListBucket.
 *
 * This runs on viewer-request, before the cache lookup, so the cached object is keyed on
 * the rewritten path. Two cases:
 *
 *   /writing/       -> /writing/index.html
 *   /writing        -> /writing/index.html   (no trailing slash, no file extension)
 *
 * Paths that already name a file are passed through untouched, so /assets/styles-abc.css
 * and /index.html are unaffected.
 */
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${var.project}-index-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite directory paths to their index.html"
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      // The /api/* behaviour has no function attached, so this should never see an API
      // path. Guarded anyway: rewriting /api/contact to /api/contact/index.html would
      // break every form submission, and that is a bad thing to depend on a config detail.
      if (uri.indexOf('/api/') === 0) {
        return request;
      }

      if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
      } else if (!uri.split('/').pop().includes('.')) {
        request.uri = uri + '/index.html';
      }

      return request;
    }
  EOT
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project} static site"
  default_root_object = "index.html"

  # PriceClass_100 is North America + Europe. Materially cheaper than the global classes;
  # switch to PriceClass_All if the audience is genuinely worldwide.
  price_class = var.price_class

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.site.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # The contact form posts to /api/contact on this same distribution, so the browser makes
  # a same-origin request: no CORS preflight, no second hostname, no extra certificate.
  origin {
    domain_name = replace(aws_apigatewayv2_api.contact.api_endpoint, "https://", "")
    origin_id   = "api-contact"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.site.id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    # Without this every visitor pays the full 237 kB instead of 87 kB. It is one line and
    # it is the single largest performance lever in the stack.
    compress = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    # Without this, every path below the root that is not a literal file returns 403.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "api-contact"
    viewer_protocol_policy = "https-only"

    # A form POST is the entire point of this behaviour; the default one allows GET/HEAD.
    allowed_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods  = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.api.id

    # Deliberately NO function_association here. The viewer-request function rewrites
    # extensionless paths to index.html, which would turn /api/contact into
    # /api/contact/index.html and 404 every submission.
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  aliases = [var.domain_name, "www.${var.domain_name}"]

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Read access for this distribution only, not for the world.
data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json

  # The public-access block must exist before a policy is attached, or the apply races.
  depends_on = [aws_s3_bucket_public_access_block.site]
}
