data "aws_caller_identity" "current" {}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  use_www     = var.www_domain != "" && var.apex_domain != ""
  use_app     = local.use_www && var.app_domain != ""
}

# ── S3 bucket ────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "spa" {
  # Include account ID to guarantee globally unique name.
  bucket = "${local.name_prefix}-spa-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "spa" {
  bucket = aws_s3_bucket.spa.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "spa" {
  bucket = aws_s3_bucket.spa.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "spa" {
  bucket                  = aws_s3_bucket.spa.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle: expire old object versions after 30 days to control storage cost.
resource "aws_s3_bucket_lifecycle_configuration" "spa" {
  bucket = aws_s3_bucket.spa.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {} # applies to all objects

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── Route 53 hosted zone ────────────────────────────────────────────────────

resource "aws_route53_zone" "apex" {
  count = local.use_www ? 1 : 0
  name  = var.apex_domain
}

# ── ACM certificate (us-east-1, required by CloudFront) ─────────────────────

resource "aws_acm_certificate" "www" {
  count                     = local.use_www ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.apex_domain
  subject_alternative_names = concat(
    [var.www_domain],
    local.use_app ? [var.app_domain] : [],
    local.use_hub ? [var.hub_domain] : [],
  )
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ACM validation CNAMEs — one per domain in the cert (apex + www SAN).
resource "aws_route53_record" "acm_validation" {
  for_each = local.use_www ? {
    for dvo in aws_acm_certificate.www[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  zone_id         = aws_route53_zone.apex[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
}

# app CNAME → CloudFront
resource "aws_route53_record" "app" {
  count   = local.use_app ? 1 : 0
  zone_id = aws_route53_zone.apex[0].zone_id
  name    = var.app_domain
  type    = "CNAME"
  records = [aws_cloudfront_distribution.spa.domain_name]
  ttl     = 300
}

# www CNAME → marketing-website CloudFront
resource "aws_route53_record" "www" {
  count   = local.use_www ? 1 : 0
  zone_id = aws_route53_zone.apex[0].zone_id
  name    = var.www_domain
  type    = "CNAME"
  records = [aws_cloudfront_distribution.web[0].domain_name]
  ttl     = 300
}

# hub CNAME → CloudFront
resource "aws_route53_record" "hub" {
  count   = local.use_hub ? 1 : 0
  zone_id = aws_route53_zone.apex[0].zone_id
  name    = var.hub_domain
  type    = "CNAME"
  records = [aws_cloudfront_distribution.hub[0].domain_name]
  ttl     = 300
}

# apex A alias → marketing-website CloudFront (Route 53 supports apex aliases to CloudFront)
resource "aws_route53_record" "apex" {
  count   = local.use_www ? 1 : 0
  zone_id = aws_route53_zone.apex[0].zone_id
  name    = var.apex_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.web[0].domain_name
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

# Waits until ACM DNS validation completes via Route 53 records above.
resource "aws_acm_certificate_validation" "www" {
  count                   = local.use_www ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.www[0].arn
  validation_record_fqdns = [for record in aws_route53_record.acm_validation : record.fqdn]
}

# ── CloudFront Origin Access Control (OAC) ───────────────────────────────────

resource "aws_cloudfront_origin_access_control" "spa" {
  name                              = "${local.name_prefix}-oac"
  description                       = "OAC for ${local.name_prefix} SPA"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront distribution ──────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "spa" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = local.name_prefix
  # PriceClass_100 = US + Canada + Europe. Use PriceClass_All for global CDN.
  price_class = "PriceClass_100"

  aliases = local.use_app ? [var.app_domain] : []

  origin {
    domain_name              = aws_s3_bucket.spa.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.spa.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.spa.id
  }

  # Default: cache everything (Vite assets have content-hash filenames).
  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.spa.id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS Managed-CachingOptimized (TTL 1 day default, 1 year max)
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # index.html must never be served stale — always revalidate.
  ordered_cache_behavior {
    path_pattern           = "/index.html"
    target_origin_id       = "s3-${aws_s3_bucket.spa.id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS Managed-CachingDisabled
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  }

  # SPA client-side routing: unknown paths return index.html with 200
  # so React Router / deep links work without server-side routing.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.use_www ? false : true
    acm_certificate_arn            = local.use_www ? aws_acm_certificate_validation.www[0].certificate_arn : null
    ssl_support_method             = local.use_www ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }
}

# ── S3 bucket policy: CloudFront OAC only ───────────────────────────────────

data "aws_iam_policy_document" "spa_bucket" {
  statement {
    sid       = "AllowCloudFrontServicePrincipal"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.spa.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.spa.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "spa" {
  bucket = aws_s3_bucket.spa.id
  policy = data.aws_iam_policy_document.spa_bucket.json

  # Public-access block must be applied first, then bucket policy.
  depends_on = [aws_s3_bucket_public_access_block.spa]
}
