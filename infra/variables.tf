variable "region" {
  description = "AWS region for the S3 bucket. CloudFront is global; this only sets the origin's home."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for resources."
  type        = string
  default     = "inevitable-frontier"
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 is North America + Europe and is the cheapest."
  type        = string
  default     = "PriceClass_100"
}

variable "domain_name" {
  description = "Apex domain. The Route 53 hosted zone must already exist."
  type        = string
  default     = "inevitablefrontier.org"
}
