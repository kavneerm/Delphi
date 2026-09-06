output "bucket" {
  description = "S3 bucket holding dist/. Used by `npm run deploy`."
  value       = aws_s3_bucket.site.id
}

output "distribution_id" {
  description = "CloudFront distribution id, for cache invalidation."
  value       = aws_cloudfront_distribution.site.id
}

output "url" {
  description = "The live site."
  value       = "https://${var.domain_name}"
}

output "cloudfront_url" {
  description = "Direct distribution URL, useful before DNS has propagated."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}
