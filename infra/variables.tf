variable "project_name" {
  description = "Project name used as prefix for all resource names."
  type        = string
  default     = "radical-tools"
}

variable "environment" {
  description = "Deployment environment (prod | staging | dev)."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment must be one of: prod, staging, dev."
  }
}

variable "aws_region" {
  description = "AWS region for the S3 bucket. CloudFront is always global."
  type        = string
  default     = "eu-west-1"
}

variable "github_repo" {
  description = "GitHub repository in 'owner/name' format. Used to scope the OIDC deploy role to pushes from the main branch only."
  type        = string
  default     = "tomasz-zajac-opensource/radical.tools"
}

variable "create_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. Set to false if it already exists in this AWS account (there can only be one per account)."
  type        = bool
  default     = true
}
