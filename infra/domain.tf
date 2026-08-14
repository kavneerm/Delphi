/**
 * Custom domain: inevitablefrontier.org (+ www), HTTPS via ACM.
 *
 * The zone already exists — the domain was registered through the Route 53 registrar, and
 * its public nameservers already point at AWS — so DNS validation completes without anyone
 * editing records at a registrar. That is the usual thing that stalls this stack for hours.
 */

data "aws_route53_zone" "site" {
  name         = var.domain_name
  private_zone = false
}

# ACM for CloudFront MUST live in us-east-1, whatever region anything else is in. An
# explicit aliased provider rather than relying on var.region happening to be us-east-1,
# so changing the bucket's region later cannot silently break TLS.
provider "aws" {
  alias  = "acm"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "inevitable-frontier"
      ManagedBy = "terraform"
    }
  }
}

resource "aws_acm_certificate" "site" {
  provider                  = aws.acm
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for option in aws_acm_certificate.site.domain_validation_options :
    option.domain_name => option
  }

  zone_id         = data.aws_route53_zone.site.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider                = aws.acm
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

# Apex and www both point at the distribution. Alias records, not CNAMEs: a CNAME cannot
# legally sit at a zone apex, and aliases are free where CNAME lookups are billed.
resource "aws_route53_record" "apex" {
  zone_id = data.aws_route53_zone.site.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  zone_id = data.aws_route53_zone.site.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
