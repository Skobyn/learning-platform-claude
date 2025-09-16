# Terraform variables for Learning Platform infrastructure

variable "project_id" {
  description = "The GCP project ID"
  type        = string
  default     = "learning-platform-prod"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "learning-platform"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "The GCP zone"
  type        = string
  default     = "us-central1-a"
}

# Network configuration
variable "subnet_cidr" {
  description = "CIDR block for the subnet"
  type        = string
  default     = "10.0.0.0/24"
}

# Database configuration
variable "database_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "learning_platform"
}

variable "db_tier" {
  description = "Cloud SQL instance tier"
  type        = string
  default     = "db-custom-2-4096"

  validation {
    condition = can(regex("^db-(custom|f1|g1|n1)", var.db_tier))
    error_message = "Database tier must be a valid Cloud SQL machine type."
  }
}

variable "db_replica_tier" {
  description = "Cloud SQL read replica instance tier"
  type        = string
  default     = "db-custom-1-2048"
}

variable "db_disk_size" {
  description = "Database disk size in GB"
  type        = number
  default     = 20

  validation {
    condition     = var.db_disk_size >= 10 && var.db_disk_size <= 1000
    error_message = "Database disk size must be between 10 GB and 1000 GB."
  }
}

# Redis configuration
variable "redis_memory_size" {
  description = "Redis memory size in GB"
  type        = number
  default     = 1

  validation {
    condition     = var.redis_memory_size >= 1 && var.redis_memory_size <= 100
    error_message = "Redis memory size must be between 1 GB and 100 GB."
  }
}

# GitHub configuration for Cloud Build
variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
  default     = "your-github-username"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "learning-platform"
}

# Monitoring configuration
variable "alert_email" {
  description = "Email address for monitoring alerts"
  type        = string
  default     = "admin@example.com"
}

# Application configuration
variable "app_domain" {
  description = "Domain name for the application"
  type        = string
  default     = "learning-platform.example.com"
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "Learning Platform"
}

# Security configuration
variable "enable_deletion_protection" {
  description = "Enable deletion protection for critical resources"
  type        = bool
  default     = true
}

variable "enable_backup" {
  description = "Enable automated backups"
  type        = bool
  default     = true
}

# Scaling configuration
variable "min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 1

  validation {
    condition     = var.min_instances >= 0 && var.min_instances <= 10
    error_message = "Minimum instances must be between 0 and 10."
  }
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 100
    error_message = "Maximum instances must be between 1 and 100."
  }
}

variable "container_concurrency" {
  description = "Maximum number of concurrent requests per container"
  type        = number
  default     = 100

  validation {
    condition     = var.container_concurrency >= 1 && var.container_concurrency <= 1000
    error_message = "Container concurrency must be between 1 and 1000."
  }
}

# Resource limits
variable "cpu_limit" {
  description = "CPU limit for Cloud Run containers"
  type        = string
  default     = "2000m"

  validation {
    condition = can(regex("^[0-9]+m?$", var.cpu_limit))
    error_message = "CPU limit must be a valid Kubernetes CPU resource format (e.g., 1000m, 2)."
  }
}

variable "memory_limit" {
  description = "Memory limit for Cloud Run containers"
  type        = string
  default     = "2Gi"

  validation {
    condition = can(regex("^[0-9]+(Mi|Gi)$", var.memory_limit))
    error_message = "Memory limit must be a valid Kubernetes memory resource format (e.g., 512Mi, 2Gi)."
  }
}

# Cost optimization
variable "enable_preemptible" {
  description = "Use preemptible instances where possible for cost savings"
  type        = bool
  default     = false
}

variable "storage_class" {
  description = "Default storage class for Cloud Storage buckets"
  type        = string
  default     = "STANDARD"

  validation {
    condition     = contains(["STANDARD", "NEARLINE", "COLDLINE", "ARCHIVE"], var.storage_class)
    error_message = "Storage class must be one of: STANDARD, NEARLINE, COLDLINE, ARCHIVE."
  }
}

# Feature flags
variable "enable_cdn" {
  description = "Enable Cloud CDN for static assets"
  type        = bool
  default     = true
}

variable "enable_ssl" {
  description = "Enable SSL/TLS encryption"
  type        = bool
  default     = true
}

variable "enable_monitoring" {
  description = "Enable comprehensive monitoring and alerting"
  type        = bool
  default     = true
}

variable "enable_logging" {
  description = "Enable centralized logging"
  type        = bool
  default     = true
}

# Environment-specific overrides
variable "environment_config" {
  description = "Environment-specific configuration overrides"
  type = object({
    db_tier                = optional(string)
    redis_memory_size      = optional(number)
    min_instances          = optional(number)
    max_instances          = optional(number)
    enable_deletion_protection = optional(bool)
  })
  default = {}
}

# Tags and labels
variable "labels" {
  description = "Additional labels to apply to resources"
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Network tags to apply to resources"
  type        = list(string)
  default     = []
}