terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is local, deliberately.
  #
  # One operator, one machine: local state is simpler and has no failure modes of its own.
  # If a second person ever runs this, move to an S3 backend with DynamoDB locking BEFORE
  # the first apply from the second machine — migrating state afterwards is avoidable work,
  # and two people applying against local state will overwrite each other's infrastructure.
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "inevitable-frontier"
      ManagedBy = "terraform"
    }
  }
}
