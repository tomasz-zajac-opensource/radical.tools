output "cloudfront_url" {
  description = "App URL via CloudFront (available immediately after apply)."
  value       = "https://${aws_cloudfront_distribution.spa.domain_name}"
}

output "s3_bucket_name" {
  description = "S3 bucket name. Set as GitHub secret: S3_BUCKET"
  value       = aws_s3_bucket.spa.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Set as GitHub secret: CLOUDFRONT_DISTRIBUTION_ID"
  value       = aws_cloudfront_distribution.spa.id
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC. Set as GitHub secret: AWS_DEPLOY_ROLE_ARN"
  value       = aws_iam_role.github_deploy.arn
}

output "acm_validation_cnames" {
  description = "Add these CNAME records in domeny.tv to validate the ACM certificate. After adding them, run terraform apply again."
  value = local.use_www ? {
    for dvo in aws_acm_certificate.www[0].domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}
}

output "route53_nameservers" {
  description = "Set these as nameservers in domeny.tv for the radical.tools domain."
  value       = local.use_www ? aws_route53_zone.apex[0].name_servers : []
}

# ── Marketing website (radical.tools + www) ──────────────────────────────────

output "web_s3_bucket_name" {
  description = "S3 bucket name for the marketing website. Set as GitHub secret: WEB_S3_BUCKET"
  value       = local.use_web ? aws_s3_bucket.web[0].id : null
}

output "web_cloudfront_distribution_id" {
  description = "CloudFront distribution ID for the marketing website. Set as GitHub secret: WEB_CLOUDFRONT_DISTRIBUTION_ID"
  value       = local.use_web ? aws_cloudfront_distribution.web[0].id : null
}

output "web_cloudfront_url" {
  description = "Marketing-site URL via CloudFront (available immediately after apply)."
  value       = local.use_web ? "https://${aws_cloudfront_distribution.web[0].domain_name}" : null
}

# ── Architecture Hub (hub.radical.tools) ──────────────────────────────────────

output "hub_s3_bucket_name" {
  description = "S3 bucket name for the architecture hub. Set as GitHub secret: HUB_S3_BUCKET"
  value       = local.use_hub ? aws_s3_bucket.hub[0].id : null
}

output "hub_cloudfront_distribution_id" {
  description = "CloudFront distribution ID for the architecture hub. Set as GitHub secret: HUB_CLOUDFRONT_DISTRIBUTION_ID"
  value       = local.use_hub ? aws_cloudfront_distribution.hub[0].id : null
}

output "hub_cloudfront_url" {
  description = "Architecture-hub URL via CloudFront (available immediately after apply)."
  value       = local.use_hub ? "https://${aws_cloudfront_distribution.hub[0].domain_name}" : null
}
