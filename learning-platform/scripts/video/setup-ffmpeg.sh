#!/bin/bash

# FFmpeg Setup Script for Learning Platform Video Infrastructure
# This script installs and configures FFmpeg with all necessary codecs and libraries

set -e  # Exit on any error

echo "🎬 Setting up FFmpeg for Learning Platform Video Infrastructure..."

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get &> /dev/null; then
            echo "ubuntu"
        elif command -v yum &> /dev/null; then
            echo "centos"
        elif command -v apk &> /dev/null; then
            echo "alpine"
        else
            echo "linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)
echo "📟 Detected OS: $OS"

# Set installation paths
FFMPEG_VERSION="6.0"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/ffmpeg"

# Create directories
create_directories() {
    echo "📁 Creating directories..."
    sudo mkdir -p $CONFIG_DIR
    sudo mkdir -p /var/log/ffmpeg
    sudo mkdir -p /tmp/ffmpeg-build
}

# Install dependencies based on OS
install_dependencies() {
    echo "📦 Installing dependencies..."

    case $OS in
        "ubuntu")
            sudo apt-get update
            sudo apt-get install -y \
                build-essential \
                cmake \
                git \
                pkg-config \
                libtool \
                automake \
                autoconf \
                nasm \
                yasm \
                libx264-dev \
                libx265-dev \
                libvpx-dev \
                libfdk-aac-dev \
                libmp3lame-dev \
                libopus-dev \
                libvorbis-dev \
                libtheora-dev \
                libfreetype6-dev \
                libfontconfig1-dev \
                libfribidi-dev \
                libharfbuzz-dev \
                libass-dev \
                libssl-dev \
                libsoxr-dev \
                libspeex-dev \
                libv4l-dev \
                libxcb1-dev \
                libxcb-shm0-dev \
                libxcb-xfixes0-dev \
                texinfo \
                wget \
                curl
            ;;
        "centos")
            sudo yum update -y
            sudo yum groupinstall -y "Development Tools"
            sudo yum install -y \
                cmake \
                git \
                pkgconfig \
                nasm \
                yasm \
                x264-devel \
                x265-devel \
                libvpx-devel \
                fdk-aac-devel \
                lame-devel \
                opus-devel \
                libvorbis-devel \
                libtheora-devel \
                freetype-devel \
                fontconfig-devel \
                fribidi-devel \
                harfbuzz-devel \
                libass-devel \
                openssl-devel \
                libsoxr-devel \
                speex-devel \
                wget \
                curl
            ;;
        "alpine")
            sudo apk update
            sudo apk add --no-cache \
                build-base \
                cmake \
                git \
                pkgconfig \
                nasm \
                yasm \
                x264-dev \
                x265-dev \
                libvpx-dev \
                fdk-aac-dev \
                lame-dev \
                opus-dev \
                libvorbis-dev \
                libtheora-dev \
                freetype-dev \
                fontconfig-dev \
                fribidi-dev \
                harfbuzz-dev \
                libass-dev \
                openssl-dev \
                soxr-dev \
                speex-dev \
                wget \
                curl
            ;;
        "macos")
            if ! command -v brew &> /dev/null; then
                echo "Installing Homebrew..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            fi

            brew update
            brew install \
                cmake \
                git \
                pkg-config \
                nasm \
                yasm \
                x264 \
                x265 \
                libvpx \
                fdk-aac \
                lame \
                opus \
                libvorbis \
                theora \
                freetype \
                fontconfig \
                fribidi \
                harfbuzz \
                libass \
                openssl \
                libsoxr \
                speex \
                wget
            ;;
        *)
            echo "❌ Unsupported OS: $OS"
            exit 1
            ;;
    esac
}

# Install FFmpeg from source with all required features
install_ffmpeg() {
    echo "🔨 Building FFmpeg from source..."

    cd /tmp/ffmpeg-build

    # Download FFmpeg source
    if [ ! -d "ffmpeg-$FFMPEG_VERSION" ]; then
        wget -q "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
        tar -xf "ffmpeg-$FFMPEG_VERSION.tar.xz"
    fi

    cd "ffmpeg-$FFMPEG_VERSION"

    # Configure build with all necessary features for streaming
    ./configure \
        --prefix=/usr/local \
        --enable-gpl \
        --enable-version3 \
        --enable-nonfree \
        --enable-static \
        --disable-debug \
        --disable-doc \
        --disable-ffplay \
        --enable-shared \
        --enable-avresample \
        --enable-libaom \
        --enable-libass \
        --enable-libfdk-aac \
        --enable-libfreetype \
        --enable-libmp3lame \
        --enable-libopus \
        --enable-libvorbis \
        --enable-libvpx \
        --enable-libx264 \
        --enable-libx265 \
        --enable-libtheora \
        --enable-libsoxr \
        --enable-libspeex \
        --enable-libfontconfig \
        --enable-libfribidi \
        --enable-openssl \
        --enable-pic \
        --extra-libs="-lpthread -lm" \
        --extra-ldexeflags="-pie"

    # Build (use all available cores)
    make -j$(nproc 2>/dev/null || echo 4)

    # Install
    sudo make install

    # Update library cache
    case $OS in
        "ubuntu"|"centos")
            sudo ldconfig
            ;;
    esac
}

# Create FFmpeg configuration files
create_config_files() {
    echo "⚙️  Creating configuration files..."

    # Create main config file
    sudo tee $CONFIG_DIR/ffmpeg.conf > /dev/null << EOF
# FFmpeg Configuration for Learning Platform
# Video Transcoding Settings

[global]
# Global settings
loglevel = info
threads = 0  # Use all available CPU cores

[video]
# Video encoding defaults
codec = libx264
preset = medium
crf = 23
profile = high
level = 4.0
pixel_format = yuv420p

[audio]
# Audio encoding defaults
codec = aac
bitrate = 128k
sample_rate = 48000
channels = 2

[hls]
# HLS streaming settings
segment_time = 6
segment_list_size = 0
segment_wrap = 0
segment_list_flags = +live

[dash]
# DASH streaming settings
segment_duration = 4
window_size = 5
extra_window_size = 5
EOF

    # Create hardware acceleration config
    sudo tee $CONFIG_DIR/hwaccel.conf > /dev/null << EOF
# Hardware Acceleration Configuration

# NVIDIA NVENC (if available)
[nvenc]
video_codec = h264_nvenc
preset = medium
profile = high
level = 4.0
rc = vbr
cq = 23
gpu = 0

# Intel Quick Sync Video (if available)
[qsv]
video_codec = h264_qsv
preset = medium
profile = high
level = 4.0
look_ahead = 1
look_ahead_depth = 40

# AMD VCE (if available)
[amf]
video_codec = h264_amf
preset = balanced
profile = high
level = 4.0
rc = vbr
quality = balanced
EOF

    # Create quality profiles
    sudo tee $CONFIG_DIR/profiles.conf > /dev/null << EOF
# Video Quality Profiles

[240p]
width = 426
height = 240
bitrate = 400k
maxrate = 500k
bufsize = 800k
fps = 30

[360p]
width = 640
height = 360
bitrate = 800k
maxrate = 1000k
bufsize = 1600k
fps = 30

[480p]
width = 854
height = 480
bitrate = 1200k
maxrate = 1500k
bufsize = 2400k
fps = 30

[720p]
width = 1280
height = 720
bitrate = 2500k
maxrate = 3000k
bufsize = 5000k
fps = 30

[1080p]
width = 1920
height = 1080
bitrate = 5000k
maxrate = 6000k
bufsize = 10000k
fps = 30
EOF

    # Create log rotation config
    sudo tee /etc/logrotate.d/ffmpeg > /dev/null << EOF
/var/log/ffmpeg/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 www-data www-data
}
EOF
}

# Create utility scripts
create_utility_scripts() {
    echo "🛠️  Creating utility scripts..."

    # Create transcoding script
    sudo tee /usr/local/bin/transcode-video > /dev/null << 'EOF'
#!/bin/bash

# Video Transcoding Utility for Learning Platform

usage() {
    echo "Usage: $0 -i input -o output [-p profile] [-f format]"
    echo "  -i: Input video file"
    echo "  -o: Output directory"
    echo "  -p: Quality profile (240p,360p,480p,720p,1080p)"
    echo "  -f: Output format (hls,dash,both)"
    exit 1
}

# Default values
PROFILE="480p"
FORMAT="hls"

while getopts "i:o:p:f:h" opt; do
    case $opt in
        i) INPUT="$OPTARG" ;;
        o) OUTPUT="$OPTARG" ;;
        p) PROFILE="$OPTARG" ;;
        f) FORMAT="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

if [ -z "$INPUT" ] || [ -z "$OUTPUT" ]; then
    usage
fi

# Load profile settings
source /etc/ffmpeg/profiles.conf

echo "🎬 Transcoding $INPUT to $PROFILE quality..."
mkdir -p "$OUTPUT"

# Get profile variables dynamically
WIDTH_VAR="${PROFILE}_width"
HEIGHT_VAR="${PROFILE}_height"
BITRATE_VAR="${PROFILE}_bitrate"

WIDTH=${!WIDTH_VAR}
HEIGHT=${!HEIGHT_VAR}
BITRATE=${!BITRATE_VAR}

if [ "$FORMAT" = "hls" ] || [ "$FORMAT" = "both" ]; then
    ffmpeg -i "$INPUT" \
        -c:v libx264 -preset medium -crf 23 \
        -vf "scale=${WIDTH}:${HEIGHT}" \
        -maxrate "$BITRATE" -bufsize "$((${BITRATE%k} * 2))k" \
        -c:a aac -b:a 128k \
        -f hls -hls_time 6 -hls_list_size 0 \
        -hls_segment_filename "$OUTPUT/segment_%03d.ts" \
        "$OUTPUT/playlist.m3u8"
fi

if [ "$FORMAT" = "dash" ] || [ "$FORMAT" = "both" ]; then
    ffmpeg -i "$INPUT" \
        -c:v libx264 -preset medium -crf 23 \
        -vf "scale=${WIDTH}:${HEIGHT}" \
        -maxrate "$BITRATE" -bufsize "$((${BITRATE%k} * 2))k" \
        -c:a aac -b:a 128k \
        -f dash -seg_duration 4 -window_size 5 \
        "$OUTPUT/manifest.mpd"
fi

echo "✅ Transcoding complete!"
EOF

    # Make script executable
    sudo chmod +x /usr/local/bin/transcode-video

    # Create thumbnail generation script
    sudo tee /usr/local/bin/generate-thumbnails > /dev/null << 'EOF'
#!/bin/bash

# Thumbnail Generation Utility

usage() {
    echo "Usage: $0 -i input -o output [-c count] [-s size]"
    echo "  -i: Input video file"
    echo "  -o: Output directory"
    echo "  -c: Number of thumbnails (default: 20)"
    echo "  -s: Thumbnail size (default: 160x90)"
    exit 1
}

COUNT=20
SIZE="160x90"

while getopts "i:o:c:s:h" opt; do
    case $opt in
        i) INPUT="$OPTARG" ;;
        o) OUTPUT="$OPTARG" ;;
        c) COUNT="$OPTARG" ;;
        s) SIZE="$OPTARG" ;;
        h) usage ;;
        *) usage ;;
    esac
done

if [ -z "$INPUT" ] || [ -z "$OUTPUT" ]; then
    usage
fi

echo "🖼️  Generating $COUNT thumbnails..."
mkdir -p "$OUTPUT"

# Get video duration
DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$INPUT")
INTERVAL=$(echo "scale=2; $DURATION / $COUNT" | bc)

# Generate thumbnails
for i in $(seq 0 $((COUNT - 1))); do
    TIMESTAMP=$(echo "scale=2; $i * $INTERVAL" | bc)
    printf -v FILENAME "thumb_%03d.jpg" $i

    ffmpeg -ss "$TIMESTAMP" -i "$INPUT" -vframes 1 \
        -vf "scale=$SIZE" -q:v 2 \
        "$OUTPUT/$FILENAME" -y -loglevel quiet

    echo -n "."
done

# Create sprite sheet
ffmpeg -i "$OUTPUT/thumb_%03d.jpg" \
    -filter_complex "tile=5x4" \
    "$OUTPUT/sprite.jpg" -y -loglevel quiet

echo ""
echo "✅ Thumbnails generated!"
EOF

    sudo chmod +x /usr/local/bin/generate-thumbnails
}

# Test FFmpeg installation
test_installation() {
    echo "🧪 Testing FFmpeg installation..."

    # Check if FFmpeg is installed and working
    if ! command -v ffmpeg &> /dev/null; then
        echo "❌ FFmpeg not found in PATH"
        exit 1
    fi

    # Check version
    echo "📋 FFmpeg version:"
    ffmpeg -version | head -1

    # Check codecs
    echo "📋 Available codecs:"
    ffmpeg -codecs 2>/dev/null | grep -E "(h264|h265|aac|mp3)" | head -5

    # Test basic functionality with a small test
    echo "🔍 Testing basic transcoding..."
    ffmpeg -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 \
        -c:v libx264 -preset ultrafast -crf 30 \
        -f mp4 -y /tmp/test_output.mp4 &>/dev/null

    if [ -f "/tmp/test_output.mp4" ]; then
        echo "✅ Basic transcoding test passed!"
        rm -f /tmp/test_output.mp4
    else
        echo "❌ Basic transcoding test failed!"
        exit 1
    fi
}

# Set up systemd service (Linux only)
setup_service() {
    if [[ "$OS" != "ubuntu" && "$OS" != "centos" ]]; then
        return
    fi

    echo "🔧 Setting up systemd service..."

    sudo tee /etc/systemd/system/video-processor.service > /dev/null << EOF
[Unit]
Description=Learning Platform Video Processor
After=network.target redis.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/learning-platform
Environment=NODE_ENV=production
Environment=FFMPEG_PATH=/usr/local/bin/ffmpeg
Environment=FFPROBE_PATH=/usr/local/bin/ffprobe
ExecStart=/usr/bin/node dist/workers/videoProcessor.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    echo "✅ Systemd service created (not started)"
}

# Main installation flow
main() {
    echo "🚀 Starting FFmpeg installation..."

    create_directories
    install_dependencies
    install_ffmpeg
    create_config_files
    create_utility_scripts
    test_installation
    setup_service

    # Cleanup
    rm -rf /tmp/ffmpeg-build

    echo ""
    echo "🎉 FFmpeg installation complete!"
    echo ""
    echo "📍 Installation summary:"
    echo "   FFmpeg binary: $(which ffmpeg)"
    echo "   Config files: $CONFIG_DIR/"
    echo "   Log directory: /var/log/ffmpeg/"
    echo "   Utility scripts: /usr/local/bin/transcode-video, /usr/local/bin/generate-thumbnails"
    echo ""
    echo "🔧 Next steps:"
    echo "   1. Update your environment variables:"
    echo "      export FFMPEG_PATH=$(which ffmpeg)"
    echo "      export FFPROBE_PATH=$(which ffprobe)"
    echo "   2. Test transcoding with: transcode-video -i input.mp4 -o output/ -p 720p"
    echo "   3. Generate thumbnails with: generate-thumbnails -i input.mp4 -o thumbs/"
    if [[ "$OS" == "ubuntu" || "$OS" == "centos" ]]; then
        echo "   4. Start video processor service: sudo systemctl start video-processor"
    fi
    echo ""
    echo "✅ Installation complete! Video infrastructure is ready."
}

# Run main installation
main "$@"