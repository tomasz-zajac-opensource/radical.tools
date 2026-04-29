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
