terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — store in S3 so your state doesn't live only on your laptop
  # Uncomment after you create the S3 bucket manually in AWS console
  # backend "s3" {
  #   bucket = "my-circle-terraform-state"
  #   key    = "infra/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
}

# ── Variables ───────────────────────────────────────────
variable "aws_region" {
  default = "us-east-1"
}

variable "app_name" {
  default = "my-circle"
}

variable "environment" {
  default = "dev"
}

# ── ECR Repository (user-service) ───────────────────────
# Step 1: Create the container registry first, then push your Docker image
resource "aws_ecr_repository" "user_service" {
  name                 = "${var.app_name}-user-service"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true   # auto-scans for known vulnerabilities on every push
  }

  tags = {
    App = var.app_name
    Env = var.environment
  }
}

# ── ECS Cluster ─────────────────────────────────────────
resource "aws_ecs_cluster" "main" {
  name = "${var.app_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"   # sends metrics to CloudWatch automatically
  }

  tags = {
    App = var.app_name
    Env = var.environment
  }
}

# ── DynamoDB — Users table ──────────────────────────────
resource "aws_dynamodb_table" "users" {
  name           = "${var.app_name}-users"
  billing_mode   = "PAY_PER_REQUEST"   # no capacity planning needed at MVP scale
  hash_key       = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  tags = {
    App = var.app_name
    Env = var.environment
  }
}

# ── DynamoDB — Messages table ───────────────────────────
resource "aws_dynamodb_table" "messages" {
  name           = "${var.app_name}-messages"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "conversationId"
  range_key      = "timestamp"

  attribute {
    name = "conversationId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  tags = {
    App = var.app_name
    Env = var.environment
  }
}

# ── Neptune cluster ─────────────────────────────────────
# Commented out until Phase 2 — Neptune is expensive to leave running
# Uncomment when you're ready to build the match-service

# resource "aws_neptune_cluster" "main" {
#   cluster_identifier = "${var.app_name}-graph"
#   engine             = "neptune"
#   skip_final_snapshot = true
#   apply_immediately  = true
#
#   tags = {
#     App = var.app_name
#     Env = var.environment
#   }
# }

# resource "aws_neptune_cluster_instance" "main" {
#   cluster_identifier = aws_neptune_cluster.main.id
#   instance_class     = "db.t3.medium"   # cheapest option for dev
#   engine             = "neptune"
#   apply_immediately  = true
# }

# ── Outputs ─────────────────────────────────────────────
output "ecr_repository_url" {
  value = aws_ecr_repository.user_service.repository_url
  description = "Push your Docker image here"
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "users_table_name" {
  value = aws_dynamodb_table.users.name
}
