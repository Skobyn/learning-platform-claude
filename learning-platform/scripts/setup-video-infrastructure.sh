#!/bin/bash

# Learning Platform Video Infrastructure Setup Script
# This script sets up enterprise-grade video streaming infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="$PROJECT_ROOT/config"
STORAGE_DIR="$PROJECT_ROOT/storage"
LOGS_DIR="$PROJECT_ROOT/logs"

# Default values
DEFAULT_REDIS_HOST="localhost"
DEFAULT_REDIS_PORT="6379"
DEFAULT_FFMPEG_PATH="/usr/bin/ffmpeg"
DEFAULT_FFPROBE_PATH="/usr/bin/ffprobe"
DEFAULT_MAX_CONCURRENT_JOBS="3"
DEFAULT_VIDEO_STORAGE_SIZE="100G"
DEFAULT_TEMP_STORAGE_SIZE="50G"

echo -e "${BLUE}🎬 Learning Platform Video Infrastructure Setup${NC}"
echo "=============================================="

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to create directory with proper permissions
create_directory() {
    local dir=$1
    local permissions=${2:-755}

    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        chmod "$permissions" "$dir"
        print_status "Created directory: $dir"
    else
        print_info "Directory already exists: $dir"
    fi
}

# Function to install system dependencies
install_system_dependencies() {
    print_info "Installing system dependencies..."

    if command_exists apt-get; then
        # Ubuntu/Debian
        print_info "Detected Ubuntu/Debian system"

        sudo apt-get update

        # Install FFmpeg
        if ! command_exists ffmpeg; then
            print_info "Installing FFmpeg..."
            sudo apt-get install -y ffmpeg
        else
            print_status "FFmpeg already installed"
        fi

        # Install additional tools
        sudo apt-get install -y \
            curl \
            wget \
            unzip \
            build-essential \
            python3-pip \
            nodejs \
            npm \
            redis-server \
            nginx \
            certbot \
            python3-certbot-nginx

    elif command_exists yum; then
        # CentOS/RHEL
        print_info "Detected CentOS/RHEL system"

        sudo yum update -y

        # Enable EPEL repository
        sudo yum install -y epel-release

        # Install FFmpeg
        if ! command_exists ffmpeg; then
            print_info "Installing FFmpeg..."
            sudo yum install -y ffmpeg ffmpeg-devel
        else
            print_status "FFmpeg already installed"
        fi

        # Install additional tools
        sudo yum install -y \
            curl \
            wget \
            unzip \
            gcc \
            gcc-c++ \
            make \
            python3-pip \
            nodejs \
            npm \
            redis \
            nginx \
            certbot \
            python3-certbot-nginx

    elif command_exists brew; then
        # macOS
        print_info "Detected macOS system"

        # Install FFmpeg
        if ! command_exists ffmpeg; then
            print_info "Installing FFmpeg..."
            brew install ffmpeg
        else
            print_status "FFmpeg already installed"
        fi

        # Install additional tools
        brew install \
            curl \
            wget \
            unzip \
            redis \
            nginx

    else
        print_error "Unsupported package manager. Please install FFmpeg and other dependencies manually."
        exit 1
    fi

    print_status "System dependencies installed"
}

# Function to setup storage directories
setup_storage() {
    print_info "Setting up storage directories..."

    # Create main storage directories
    create_directory "$STORAGE_DIR" 755
    create_directory "$STORAGE_DIR/videos" 755
    create_directory "$STORAGE_DIR/temp" 755
    create_directory "$STORAGE_DIR/uploads" 755
    create_directory "$STORAGE_DIR/transcoding" 755
    create_directory "$STORAGE_DIR/thumbnails" 755
    create_directory "$STORAGE_DIR/previews" 755
    create_directory "$STORAGE_DIR/backups" 755

    # Create subdirectories for different video formats
    create_directory "$STORAGE_DIR/videos/hls" 755
    create_directory "$STORAGE_DIR/videos/dash" 755
    create_directory "$STORAGE_DIR/videos/mp4" 755
    create_directory "$STORAGE_DIR/videos/subtitles" 755

    # Create temp directories for processing
    create_directory "$STORAGE_DIR/temp/uploads" 755
    create_directory "$STORAGE_DIR/temp/processing" 755
    create_directory "$STORAGE_DIR/temp/chunks" 755

    # Create logs directory
    create_directory "$LOGS_DIR" 755
    create_directory "$LOGS_DIR/transcoding" 755
    create_directory "$LOGS_DIR/streaming" 755
    create_directory "$LOGS_DIR/uploads" 755

    # Set up log rotation
    if command_exists logrotate; then
        sudo tee /etc/logrotate.d/learning-platform-videos > /dev/null << EOF
$LOGS_DIR/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
EOF
        print_status "Log rotation configured"
    fi

    print_status "Storage directories created"
}

# Function to setup Redis
setup_redis() {
    print_info "Setting up Redis..."

    if ! command_exists redis-server; then
        print_error "Redis is not installed. Please install Redis first."
        return 1
    fi

    # Configure Redis for video streaming
    local redis_conf="/etc/redis/redis.conf"

    if [ -f "$redis_conf" ]; then
        # Backup original config
        sudo cp "$redis_conf" "$redis_conf.backup.$(date +%Y%m%d_%H%M%S)"

        # Update Redis configuration for video streaming
        sudo tee -a "$redis_conf" > /dev/null << EOF

# Video streaming optimizations
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000

# Network optimizations
tcp-keepalive 300
timeout 300

# Persistence
dir /var/lib/redis
EOF

        # Restart Redis
        if command_exists systemctl; then
            sudo systemctl restart redis-server
            sudo systemctl enable redis-server
        elif command_exists service; then
            sudo service redis-server restart
        fi

        print_status "Redis configured and restarted"
    else
        print_warning "Redis config file not found at $redis_conf"
    fi
}

# Function to setup Nginx
setup_nginx() {
    print_info "Setting up Nginx..."

    if ! command_exists nginx; then
        print_error "Nginx is not installed. Please install Nginx first."
        return 1
    fi

    # Create Nginx configuration for video streaming
    local nginx_conf="/etc/nginx/sites-available/video-streaming"

    sudo tee "$nginx_conf" > /dev/null << 'EOF'
# Video Streaming Configuration
upstream video_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=video_upload:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=video_stream:10m rate=100r/m;

server {
    listen 80;
    server_name videos.yourdomain.com stream.yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name videos.yourdomain.com stream.yourdomain.com;

    # SSL Configuration (update paths as needed)
    ssl_certificate /etc/ssl/certs/video-ssl.crt;
    ssl_certificate_key /etc/ssl/private/video-ssl.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Client body size for video uploads
    client_max_body_size 10G;
    client_body_timeout 300s;
    client_header_timeout 300s;

    # Proxy timeouts
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;

    # Video upload endpoints
    location /api/video/upload {
        limit_req zone=video_upload burst=10 nodelay;
        proxy_pass http://video_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Disable proxy buffering for uploads
        proxy_request_buffering off;
    }

    # Video streaming endpoints
    location /api/video/stream {
        limit_req zone=video_stream burst=50 nodelay;

        # Enable caching for video segments
        location ~* \.(m3u8|mpd)$ {
            expires 5m;
            add_header Cache-Control "public, must-revalidate, proxy-revalidate";
            add_header Access-Control-Allow-Origin "*";
            proxy_pass http://video_backend;
        }

        location ~* \.(ts|m4s|mp4)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            add_header Access-Control-Allow-Origin "*";
            proxy_pass http://video_backend;
        }

        # Default streaming proxy
        proxy_pass http://video_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Enable range requests for video seeking
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
        proxy_no_cache $http_range $http_if_range;
    }

    # Direct file serving for processed videos
    location /storage/ {
        alias /path/to/storage/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header Access-Control-Allow-Origin "*";

        # Enable range requests
        add_header Accept-Ranges bytes;

        # Secure file access
        internal;

        location ~* \.(m3u8|mpd)$ {
            expires 5m;
            add_header Cache-Control "public, must-revalidate";
        }
    }

    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # Deny access to sensitive files
    location ~ /\. {
        deny all;
    }

    location ~* \.(env|log|tmp)$ {
        deny all;
    }
}
EOF

    # Enable the site
    sudo ln -sf "$nginx_conf" /etc/nginx/sites-enabled/

    # Test Nginx configuration
    if sudo nginx -t; then
        # Restart Nginx
        if command_exists systemctl; then
            sudo systemctl restart nginx
            sudo systemctl enable nginx
        elif command_exists service; then
            sudo service nginx restart
        fi
        print_status "Nginx configured and restarted"
    else
        print_error "Nginx configuration test failed"
        return 1
    fi
}

# Function to setup SSL certificates
setup_ssl() {
    print_info "Setting up SSL certificates..."

    if ! command_exists certbot; then
        print_error "Certbot is not installed. Please install Certbot first."
        return 1
    fi

    # This is a placeholder - you'll need to customize for your domain
    print_warning "SSL setup requires manual configuration for your domain"
    print_info "Run: sudo certbot --nginx -d videos.yourdomain.com -d stream.yourdomain.com"
}

# Function to setup PM2 for process management
setup_pm2() {
    print_info "Setting up PM2 for process management..."

    if ! command_exists pm2; then
        print_info "Installing PM2..."
        sudo npm install -g pm2
    fi

    # Create PM2 ecosystem file
    cat > "$PROJECT_ROOT/ecosystem.config.js" << EOF
module.exports = {
  apps: [
    {
      name: 'learning-platform',
      script: 'npm',
      args: 'start',
      cwd: '$PROJECT_ROOT',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        VIDEO_STORAGE_PATH: '$STORAGE_DIR/videos',
        TEMP_STORAGE_PATH: '$STORAGE_DIR/temp',
        REDIS_HOST: '$DEFAULT_REDIS_HOST',
        REDIS_PORT: '$DEFAULT_REDIS_PORT',
        FFMPEG_PATH: '$DEFAULT_FFMPEG_PATH',
        ENABLE_GPU_ACCELERATION: 'false',
        MAX_CONCURRENT_TRANSCODING: '$DEFAULT_MAX_CONCURRENT_JOBS'
      },
      error_file: '$LOGS_DIR/app-error.log',
      out_file: '$LOGS_DIR/app-out.log',
      log_file: '$LOGS_DIR/app.log',
      time: true,
      max_memory_restart: '2G',
      node_args: '--max_old_space_size=4096'
    },
    {
      name: 'video-transcoder',
      script: '$PROJECT_ROOT/scripts/transcoding-worker.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        VIDEO_STORAGE_PATH: '$STORAGE_DIR/videos',
        TEMP_STORAGE_PATH: '$STORAGE_DIR/temp',
        REDIS_HOST: '$DEFAULT_REDIS_HOST',
        REDIS_PORT: '$DEFAULT_REDIS_PORT',
        FFMPEG_PATH: '$DEFAULT_FFMPEG_PATH',
        MAX_CONCURRENT_JOBS: '$DEFAULT_MAX_CONCURRENT_JOBS'
      },
      error_file: '$LOGS_DIR/transcoder-error.log',
      out_file: '$LOGS_DIR/transcoder-out.log',
      log_file: '$LOGS_DIR/transcoder.log',
      time: true,
      max_memory_restart: '4G'
    }
  ]
};
EOF

    print_status "PM2 ecosystem configured"
}

# Function to setup monitoring
setup_monitoring() {
    print_info "Setting up monitoring..."

    # Create monitoring script
    cat > "$PROJECT_ROOT/scripts/monitor-video-services.sh" << 'EOF'
#!/bin/bash

# Video Services Monitoring Script

LOG_FILE="/var/log/video-monitor.log"
STORAGE_PATH="${VIDEO_STORAGE_PATH:-./storage}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check disk space
check_disk_space() {
    local usage=$(df "$STORAGE_PATH" | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$usage" -gt 90 ]; then
        log_message "WARNING: Disk usage is ${usage}%"
        # Alert logic here (email, slack, etc.)
    fi
}

# Check Redis connection
check_redis() {
    if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
        log_message "ERROR: Redis connection failed"
        # Alert logic here
    fi
}

# Check FFmpeg
check_ffmpeg() {
    if ! command -v ffmpeg > /dev/null 2>&1; then
        log_message "ERROR: FFmpeg not found"
        # Alert logic here
    fi
}

# Check transcoding queue
check_transcoding_queue() {
    local queue_length=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" llen transcoding:queue 2>/dev/null || echo "0")
    if [ "$queue_length" -gt 100 ]; then
        log_message "WARNING: Transcoding queue length is $queue_length"
        # Alert logic here
    fi
}

# Run all checks
check_disk_space
check_redis
check_ffmpeg
check_transcoding_queue

log_message "Monitoring check completed"
EOF

    chmod +x "$PROJECT_ROOT/scripts/monitor-video-services.sh"

    # Add to crontab
    (crontab -l 2>/dev/null; echo "*/5 * * * * $PROJECT_ROOT/scripts/monitor-video-services.sh") | crontab -

    print_status "Monitoring setup completed"
}

# Function to create environment file
create_env_file() {
    print_info "Creating environment configuration..."

    local env_file="$PROJECT_ROOT/.env.video"

    cat > "$env_file" << EOF
# Video Infrastructure Environment Variables

# Storage Paths
VIDEO_STORAGE_PATH=$STORAGE_DIR/videos
TEMP_STORAGE_PATH=$STORAGE_DIR/temp
LOG_PATH=$LOGS_DIR

# Redis Configuration
REDIS_HOST=$DEFAULT_REDIS_HOST
REDIS_PORT=$DEFAULT_REDIS_PORT
REDIS_PASSWORD=

# FFmpeg Configuration
FFMPEG_PATH=$DEFAULT_FFMPEG_PATH
FFPROBE_PATH=$DEFAULT_FFPROBE_PATH
ENABLE_GPU_ACCELERATION=false
ENABLE_TWO_PASS=false

# Transcoding Configuration
MAX_CONCURRENT_TRANSCODING=$DEFAULT_MAX_CONCURRENT_JOBS
DEFAULT_CHUNK_DURATION=4
ENABLE_AUDIO_NORMALIZATION=true

# CDN Configuration
CDN_BASE_URL=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
CLOUDFLARE_ACCOUNT_ID=

# Security
VIDEO_ENCRYPTION_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)

# Upload Configuration
MAX_UPLOAD_SIZE=10737418240
CHUNK_SIZE=5242880
UPLOAD_TIMEOUT=3600

# Quality Profiles
ENABLE_240P=true
ENABLE_360P=true
ENABLE_480P=true
ENABLE_720P=true
ENABLE_1080P=true
ENABLE_1440P=false
ENABLE_4K=false

# Monitoring
ENABLE_ANALYTICS=true
METRICS_RETENTION_DAYS=30

# Backup
ENABLE_BACKUP=true
BACKUP_SCHEDULE="0 2 * * *"
BACKUP_RETENTION_DAYS=30
EOF

    chmod 600 "$env_file"
    print_status "Environment file created: $env_file"
}

# Function to run system optimizations
optimize_system() {
    print_info "Applying system optimizations..."

    # Increase file limits
    if [ -f /etc/security/limits.conf ]; then
        sudo tee -a /etc/security/limits.conf > /dev/null << EOF

# Video streaming optimizations
* soft nofile 65536
* hard nofile 65536
* soft nproc 65536
* hard nproc 65536
EOF
    fi

    # Kernel optimizations for video streaming
    sudo tee -a /etc/sysctl.conf > /dev/null << EOF

# Video streaming network optimizations
net.core.rmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_default = 262144
net.core.wmem_max = 16777216
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_rmem = 4096 65536 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_congestion_control = bbr
net.core.default_qdisc = fq

# File system optimizations
fs.file-max = 2097152
vm.swappiness = 10
EOF

    # Apply sysctl settings
    sudo sysctl -p

    print_status "System optimizations applied"
}

# Function to test installation
test_installation() {
    print_info "Testing installation..."

    # Test FFmpeg
    if command_exists ffmpeg; then
        local ffmpeg_version=$(ffmpeg -version | head -n1)
        print_status "FFmpeg: $ffmpeg_version"
    else
        print_error "FFmpeg not found"
    fi

    # Test Redis
    if redis-cli ping > /dev/null 2>&1; then
        print_status "Redis: Connection successful"
    else
        print_error "Redis: Connection failed"
    fi

    # Test storage directories
    if [ -d "$STORAGE_DIR/videos" ] && [ -w "$STORAGE_DIR/videos" ]; then
        print_status "Storage: Writable"
    else
        print_error "Storage: Not writable"
    fi

    # Test Nginx
    if command_exists nginx && nginx -t > /dev/null 2>&1; then
        print_status "Nginx: Configuration valid"
    else
        print_warning "Nginx: Configuration may have issues"
    fi

    print_status "Installation test completed"
}

# Main installation flow
main() {
    print_info "Starting video infrastructure setup..."

    # Check if running as root for system operations
    if [[ $EUID -eq 0 ]]; then
        print_warning "Running as root. Some operations will be performed without sudo."
    fi

    # Install system dependencies
    install_system_dependencies

    # Setup storage
    setup_storage

    # Setup Redis
    setup_redis

    # Setup Nginx
    setup_nginx

    # Setup PM2
    setup_pm2

    # Setup monitoring
    setup_monitoring

    # Create environment file
    create_env_file

    # Optimize system
    optimize_system

    # Test installation
    test_installation

    print_status "Video infrastructure setup completed!"
    echo ""
    echo -e "${GREEN}Next steps:${NC}"
    echo "1. Update the domains in /etc/nginx/sites-available/video-streaming"
    echo "2. Run: sudo certbot --nginx -d videos.yourdomain.com -d stream.yourdomain.com"
    echo "3. Update the .env.video file with your specific configuration"
    echo "4. Start the application: pm2 start ecosystem.config.js"
    echo "5. Save PM2 configuration: pm2 save && pm2 startup"
    echo ""
    echo -e "${BLUE}Configuration files:${NC}"
    echo "- Environment: $PROJECT_ROOT/.env.video"
    echo "- PM2 Config: $PROJECT_ROOT/ecosystem.config.js"
    echo "- Nginx Config: /etc/nginx/sites-available/video-streaming"
    echo "- Storage Path: $STORAGE_DIR"
    echo "- Logs Path: $LOGS_DIR"
}

# Run main function
main "$@"