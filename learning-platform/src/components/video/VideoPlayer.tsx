'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Settings,
  SkipBack,
  SkipForward,
  FileText,
  MessageSquare,
  Download,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface VideoQuality {
  label: string;
  value: string;
  resolution: string;
}

interface Chapter {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
}

interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  src: string;
}

interface VideoPlayerProps {
  videoUrl: string;
  title?: string;
  description?: string;
  qualities?: VideoQuality[];
  chapters?: Chapter[];
  subtitles?: SubtitleTrack[];
  currentTime?: number;
  onProgressUpdate?: (time: number) => void;
  onComplete?: () => void;
  onQualityChange?: (quality: string) => void;
  onSpeedChange?: (speed: number) => void;
  showTranscript?: boolean;
  showNotes?: boolean;
  allowDownload?: boolean;
  className?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  title,
  description,
  qualities = [
    { label: '1080p', value: '1080p', resolution: 'HD' },
    { label: '720p', value: '720p', resolution: 'HD' },
    { label: '480p', value: '480p', resolution: 'SD' },
    { label: '360p', value: '360p', resolution: 'SD' },
    { label: '240p', value: '240p', resolution: 'SD' },
    { label: 'Auto', value: 'auto', resolution: 'Auto' }
  ],
  chapters = [],
  subtitles = [],
  currentTime: initialTime = 0,
  onProgressUpdate,
  onComplete,
  onQualityChange,
  onSpeedChange,
  showTranscript = true,
  showNotes = true,
  allowDownload = false,
  className
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(initialTime);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showChapterList, setShowChapterList] = useState(false);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);

  const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  // Initialize video
  useEffect(() => {
    if (videoRef.current && initialTime > 0) {
      videoRef.current.currentTime = initialTime;
    }
  }, [initialTime]);

  // Handle play/pause
  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // Handle volume change
  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
    }
    setIsMuted(newVolume === 0);
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;

    if (isMuted) {
      videoRef.current.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      videoRef.current.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;

    const current = videoRef.current.currentTime;
    setCurrentVideoTime(current);

    // Update buffered amount
    if (videoRef.current.buffered.length > 0) {
      const bufferedEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      const bufferedAmount = (bufferedEnd / videoRef.current.duration) * 100;
      setBuffered(bufferedAmount);
    }

    // Check for active chapter
    const chapter = chapters.find(
      ch => current >= ch.startTime && current <= ch.endTime
    );
    setActiveChapter(chapter || null);

    // Callback for progress tracking
    if (onProgressUpdate) {
      onProgressUpdate(current);
    }

    // Check if video completed
    if (current >= videoRef.current.duration - 0.5 && onComplete) {
      onComplete();
    }
  }, [chapters, onProgressUpdate, onComplete]);

  // Handle seek
  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !progressBarRef.current) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;

    videoRef.current.currentTime = newTime;
    setCurrentVideoTime(newTime);
  }, [duration]);

  // Skip forward/backward
  const skip = useCallback((seconds: number) => {
    if (!videoRef.current) return;

    const newTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, duration));
    videoRef.current.currentTime = newTime;
    setCurrentVideoTime(newTime);
  }, [duration]);

  // Handle quality change
  const handleQualityChange = useCallback((quality: string) => {
    setSelectedQuality(quality);
    if (onQualityChange) {
      onQualityChange(quality);
    }
    // Here you would typically update the video source
    // based on the selected quality
  }, [onQualityChange]);

  // Handle speed change
  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    if (onSpeedChange) {
      onSpeedChange(speed);
    }
  }, [onSpeedChange]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  // Jump to chapter
  const jumpToChapter = useCallback((chapter: Chapter) => {
    if (!videoRef.current) return;

    videoRef.current.currentTime = chapter.startTime;
    setCurrentVideoTime(chapter.startTime);
    setShowChapterList(false);
    if (!isPlaying) {
      togglePlayPause();
    }
  }, [isPlaying, togglePlayPause]);

  // Format time
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!videoRef.current) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          skip(-10);
          break;
        case 'ArrowRight':
          skip(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange([Math.min(1, volume + 0.1)]);
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange([Math.max(0, volume - 0.1)]);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          toggleMute();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [togglePlayPause, skip, handleVolumeChange, volume, toggleFullscreen, toggleMute]);

  // Auto-hide controls
  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };

    if (containerRef.current) {
      containerRef.current.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousemove', handleMouseMove);
      }
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className={cn('relative bg-black rounded-lg overflow-hidden group', className)}>
      <div ref={containerRef} className="relative aspect-video">
        {/* Video Element */}
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            setDuration(video.duration);
            setIsLoading(false);
          }}
          onEnded={() => {
            setIsPlaying(false);
            if (onComplete) onComplete();
          }}
          onClick={togglePlayPause}
        />

        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Chapter List Overlay */}
        {showChapterList && chapters.length > 0 && (
          <div className="absolute top-0 right-0 w-80 h-full bg-black/90 p-4 overflow-y-auto">
            <h3 className="text-white font-semibold mb-4">Chapters</h3>
            <div className="space-y-2">
              {chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  onClick={() => jumpToChapter(chapter)}
                  className={cn(
                    'w-full text-left p-3 rounded hover:bg-white/10 transition',
                    activeChapter?.id === chapter.id && 'bg-white/20'
                  )}
                >
                  <div className="text-white text-sm font-medium">{chapter.title}</div>
                  <div className="text-white/60 text-xs">{formatTime(chapter.startTime)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Controls Overlay */}
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 transition-opacity duration-300',
            showControls ? 'opacity-100' : 'opacity-0'
          )}
        >
          {/* Progress Bar */}
          <div className="mb-4">
            <div
              ref={progressBarRef}
              className="relative h-1 bg-white/30 rounded-full cursor-pointer group/progress"
              onClick={handleSeek}
            >
              {/* Buffered Progress */}
              <div
                className="absolute h-full bg-white/40 rounded-full"
                style={{ width: `${buffered}%` }}
              />
              {/* Played Progress */}
              <div
                className="absolute h-full bg-blue-500 rounded-full"
                style={{ width: `${(currentVideoTime / duration) * 100}%` }}
              />
              {/* Chapter Markers */}
              {chapters.map((chapter) => (
                <div
                  key={chapter.id}
                  className="absolute top-1/2 -translate-y-1/2 w-1 h-2 bg-yellow-500"
                  style={{ left: `${(chapter.startTime / duration) * 100}%` }}
                  title={chapter.title}
                />
              ))}
              {/* Hover Indicator */}
              <div className="absolute h-3 bg-blue-500 rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity"
                style={{ width: `${(currentVideoTime / duration) * 100}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full" />
              </div>
            </div>
            {/* Time Display */}
            <div className="flex justify-between mt-1">
              <span className="text-white text-xs">{formatTime(currentVideoTime)}</span>
              <span className="text-white text-xs">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {/* Play/Pause */}
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlayPause}
                className="text-white hover:bg-white/20"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>

              {/* Skip Backward */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => skip(-10)}
                className="text-white hover:bg-white/20"
              >
                <SkipBack className="h-4 w-4" />
              </Button>

              {/* Skip Forward */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => skip(10)}
                className="text-white hover:bg-white/20"
              >
                <SkipForward className="h-4 w-4" />
              </Button>

              {/* Volume Controls */}
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleMute}
                  className="text-white hover:bg-white/20"
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  onValueChange={handleVolumeChange}
                  max={1}
                  step={0.1}
                  className="w-20"
                />
              </div>

              {/* Current Chapter */}
              {activeChapter && (
                <div className="text-white text-sm ml-4">
                  <span className="text-white/60">Chapter:</span> {activeChapter.title}
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {/* Speed Control */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-white hover:bg-white/20">
                    {playbackSpeed}x
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Playback Speed</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {playbackSpeeds.map((speed) => (
                    <DropdownMenuItem
                      key={speed}
                      onClick={() => handleSpeedChange(speed)}
                      className={playbackSpeed === speed ? 'bg-blue-500/20' : ''}
                    >
                      {speed}x {speed === 1 && '(Normal)'}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Quality Settings */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Video Quality</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {qualities.map((quality) => (
                    <DropdownMenuItem
                      key={quality.value}
                      onClick={() => handleQualityChange(quality.value)}
                      className={selectedQuality === quality.value ? 'bg-blue-500/20' : ''}
                    >
                      {quality.label} {quality.resolution !== quality.label && `(${quality.resolution})`}
                    </DropdownMenuItem>
                  ))}
                  {subtitles.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Subtitles</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setSelectedSubtitle(null)}>
                        Off
                      </DropdownMenuItem>
                      {subtitles.map((subtitle) => (
                        <DropdownMenuItem
                          key={subtitle.id}
                          onClick={() => setSelectedSubtitle(subtitle.id)}
                          className={selectedSubtitle === subtitle.id ? 'bg-blue-500/20' : ''}
                        >
                          {subtitle.label}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Chapter List */}
              {chapters.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowChapterList(!showChapterList)}
                  className="text-white hover:bg-white/20"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}

              {/* Transcript */}
              {showTranscript && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  title="Show Transcript"
                >
                  <FileText className="h-4 w-4" />
                </Button>
              )}

              {/* Notes */}
              {showNotes && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  title="Take Notes"
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              )}

              {/* Download */}
              {allowDownload && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  title="Download for Offline"
                >
                  <Download className="h-4 w-4" />
                </Button>
              )}

              {/* Fullscreen */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFullscreen}
                className="text-white hover:bg-white/20"
              >
                <Maximize className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Video Title and Description */}
      {(title || description) && (
        <div className="p-4 bg-gray-900">
          {title && <h2 className="text-white text-lg font-semibold mb-2">{title}</h2>}
          {description && <p className="text-gray-400 text-sm">{description}</p>}
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;