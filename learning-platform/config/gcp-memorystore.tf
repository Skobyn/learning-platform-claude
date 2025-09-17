# Google Cloud Memorystore Redis Instance Configuration
# Production-ready Redis setup for the Learning Platform

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 4.0"
    }
  }
}

# Variables
variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (prod, staging, dev)"
  type        = string
  default     = "prod"
}

# Main Redis Instance (High Availability)
resource "google_redis_instance" "learning_platform_redis" {
  name               = "learning-platform-redis-${var.environment}"
  project            = var.project_id
  region             = var.region
  location_id        = "${var.region}-a"
  alternative_location_id = "${var.region}-b"

  # Memory configuration
  memory_size_gb = 12

  # Redis version
  redis_version = "REDIS_6_X"

  # High Availability
  tier = "STANDARD_HA"

  # Networking
  authorized_network = google_compute_network.redis_network.id
  connect_mode       = "DIRECT_PEERING"

  # Security
  auth_enabled                = true
  transit_encryption_mode     = "SERVER_AUTH"

  # Persistence
  persistence_config {
    persistence_mode    = "RDB"
    rdb_snapshot_period = "TWENTY_FOUR_HOURS"
    rdb_snapshot_start_time = "02:00"
  }

  # Maintenance
  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 3
        minutes = 0
        seconds = 0
        nanos   = 0
      }
      duration = "PT4H" # 4 hours
    }
  }

  # Read Replicas for scaling reads
  read_replicas_mode = "READ_REPLICAS_ENABLED"
  replica_count      = 2

  # Labels
  labels = {
    environment = var.environment
    application = "learning-platform"
    team        = "backend"
    tier        = "cache"
  }

  # Display name
  display_name = "Learning Platform Redis Cluster - ${title(var.environment)}"
}

# Additional Redis Instance for Sessions (if needed for separation)
resource "google_redis_instance" "learning_platform_sessions" {
  name               = "learning-platform-sessions-${var.environment}"
  project            = var.project_id
  region             = var.region
  location_id        = "${var.region}-a"
  alternative_location_id = "${var.region}-b"

  # Memory configuration (smaller for sessions only)
  memory_size_gb = 4

  # Redis version
  redis_version = "REDIS_6_X"

  # High Availability
  tier = "STANDARD_HA"

  # Networking
  authorized_network = google_compute_network.redis_network.id
  connect_mode       = "DIRECT_PEERING"

  # Security
  auth_enabled                = true
  transit_encryption_mode     = "SERVER_AUTH"

  # Maintenance
  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 3
        minutes = 30
        seconds = 0
        nanos   = 0
      }
      duration = "PT2H" # 2 hours
    }
  }

  # Labels
  labels = {
    environment = var.environment
    application = "learning-platform"
    team        = "backend"
    tier        = "sessions"
  }

  # Display name
  display_name = "Learning Platform Sessions Redis - ${title(var.environment)}"
}

# VPC Network for Redis instances
resource "google_compute_network" "redis_network" {
  name                    = "redis-network-${var.environment}"
  project                 = var.project_id
  auto_create_subnetworks = false
  description             = "VPC network for Redis instances"
}

# Subnet for Redis
resource "google_compute_subnetwork" "redis_subnet" {
  name          = "redis-subnet-${var.environment}"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.redis_network.id
  ip_cidr_range = "10.0.1.0/24"
  description   = "Subnet for Redis instances"

  # Private Google Access for Redis
  private_ip_google_access = true
}

# Firewall rules
resource "google_compute_firewall" "redis_internal" {
  name    = "redis-internal-${var.environment}"
  project = var.project_id
  network = google_compute_network.redis_network.name

  allow {
    protocol = "tcp"
    ports    = ["6379", "6380", "16379", "16380"]
  }

  source_ranges = ["10.0.0.0/8"]
  target_tags   = ["redis"]

  description = "Allow internal Redis traffic"
}

# VPC Peering for connecting to application VPC
resource "google_compute_network_peering" "redis_to_app" {
  name         = "redis-to-app-${var.environment}"
  network      = google_compute_network.redis_network.id
  peer_network = var.app_vpc_network_id # This would be passed as a variable

  auto_create_routes = true

  depends_on = [google_compute_network.redis_network]
}

# Monitoring and Alerting
resource "google_monitoring_alert_policy" "redis_memory_usage" {
  display_name = "Redis Memory Usage High - ${title(var.environment)}"
  project      = var.project_id

  conditions {
    display_name = "Redis memory usage above 80%"

    condition_threshold {
      filter          = "resource.type=\"gce_instance\" AND metric.type=\"redis.googleapis.com/stats/memory/usage_ratio\""
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 0.80

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  enabled = true
}

resource "google_monitoring_alert_policy" "redis_connection_count" {
  display_name = "Redis Connection Count High - ${title(var.environment)}"
  project      = var.project_id

  conditions {
    display_name = "Redis connected clients above 8000"

    condition_threshold {
      filter          = "resource.type=\"gce_instance\" AND metric.type=\"redis.googleapis.com/stats/connections/connected_clients\""
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 8000

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  enabled = true
}

# Outputs
output "redis_host" {
  description = "The IP address of the Redis instance"
  value       = google_redis_instance.learning_platform_redis.host
}

output "redis_port" {
  description = "The port number of the Redis instance"
  value       = google_redis_instance.learning_platform_redis.port
}

output "redis_auth_string" {
  description = "The AUTH string for the Redis instance"
  value       = google_redis_instance.learning_platform_redis.auth_string
  sensitive   = true
}

output "sessions_redis_host" {
  description = "The IP address of the Sessions Redis instance"
  value       = google_redis_instance.learning_platform_sessions.host
}

output "sessions_redis_port" {
  description = "The port number of the Sessions Redis instance"
  value       = google_redis_instance.learning_platform_sessions.port
}

output "sessions_redis_auth_string" {
  description = "The AUTH string for the Sessions Redis instance"
  value       = google_redis_instance.learning_platform_sessions.auth_string
  sensitive   = true
}

output "redis_connection_string" {
  description = "Redis connection string for the main instance"
  value       = "rediss://:${google_redis_instance.learning_platform_redis.auth_string}@${google_redis_instance.learning_platform_redis.host}:${google_redis_instance.learning_platform_redis.port}"
  sensitive   = true
}

output "sessions_connection_string" {
  description = "Redis connection string for the sessions instance"
  value       = "rediss://:${google_redis_instance.learning_platform_sessions.auth_string}@${google_redis_instance.learning_platform_sessions.host}:${google_redis_instance.learning_platform_sessions.port}"
  sensitive   = true
}