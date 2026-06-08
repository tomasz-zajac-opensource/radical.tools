# Architecture Concept Hub (hub.radical.tools)
# Separate S3 bucket and CloudFront distribution from the SPA (app.radical.tools).
# Shares the ACM cert defined in main.tf (which already covers apex + www + app + hub).

locals {
  use_hub = local.use_www && var.hub_domain != ""
}

# ── S3 bucket ────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "hub" {
  count  = local.use_hub ? 1 : 0
  bucket = "${local.name_prefix}-hub-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "hub" {
  count  = local.use_hub ? 1 : 0
  bucket = aws_s3_bucket.hub[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "hub" {
  count  = local.use_hub ? 1 : 0
  bucket = aws_s3_bucket.hub[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "hub" {
  count                   = local.use_hub ? 1 : 0
  bucket                  = aws_s3_bucket.hub[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "hub" {
  count  = local.use_hub ? 1 : 0
  bucket = aws_s3_bucket.hub[0].id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── CloudFront OAC ───────────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "hub" {
  count                             = local.use_hub ? 1 : 0
  name                              = "${local.name_prefix}-hub-oac"
  description                       = "OAC for ${local.name_prefix} architecture hub"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront response headers policy (CORS for app.radical.tools) ──────────

resource "aws_cloudfront_response_headers_policy" "hub_cors" {
  count   = local.use_hub ? 1 : 0
  name    = "${local.name_prefix}-hub-cors"
  comment = "CORS headers for hub — allows app.radical.tools to fetch hub-data.json"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }

    access_control_allow_origins {
      items = ["https://app.radical.tools", "https://radical.tools", "http://localhost:*"]
    }

    access_control_max_age_sec = 86400
    origin_override            = true
  }
}

# ── CloudFront distribution ──────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "hub" {
  count               = local.use_hub ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${local.name_prefix}-hub"
  price_class         = "PriceClass_100"

  aliases = [var.hub_domain]

  origin {
    domain_name              = aws_s3_bucket.hub[0].bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.hub[0].id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.hub[0].id
  }

  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.hub[0].id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS Managed-CachingOptimized
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # HTML entry point: always revalidate so deploys are visible immediately.
  ordered_cache_behavior {
    path_pattern           = "/index.html"
    target_origin_id       = "s3-${aws_s3_bucket.hub[0].id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS Managed-CachingDisabled
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  }

  # Concept data: always revalidate so concept updates are immediate.
  # CORS enabled so app.radical.tools can fetch this cross-origin.
  ordered_cache_behavior {
    path_pattern           = "/hub-data.json"
    target_origin_id       = "s3-${aws_s3_bucket.hub[0].id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS Managed-CachingDisabled
    cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.hub_cors[0].id
  }

  # Static site: 403/404 → friendly 404.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.www[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ── S3 bucket policy: CloudFront OAC only ───────────────────────────────────

data "aws_iam_policy_document" "hub_bucket" {
  count = local.use_hub ? 1 : 0

  statement {
    sid       = "AllowCloudFrontServicePrincipal"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.hub[0].arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.hub[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "hub" {
  count  = local.use_hub ? 1 : 0
  bucket = aws_s3_bucket.hub[0].id
  policy = data.aws_iam_policy_document.hub_bucket[0].json

  depends_on = [aws_s3_bucket_public_access_block.hub]
}
