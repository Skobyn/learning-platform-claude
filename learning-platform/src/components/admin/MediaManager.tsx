'use client';

import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  DataTable, 
  createSortableHeader, 
  createActionColumn, 
  createSelectionColumn 
} from '@/components/ui/DataTable';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Upload,
  File,
  Image,
  Video,
  FileText,
  Music,
  Archive,
  Eye,
  Download,
  Trash2,
  Copy,
  Edit3,
  Folder,
  FolderPlus,
  Search,
  Filter,
  RefreshCw,
  CloudUpload,
  HardDrive,
  Zap,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Clock,
  Settings,
  MoreVertical,
  Link as LinkIcon,
} from 'lucide-react';
import { MediaFile } from '@/types';
import { formatFileSize, formatDate } from '@/lib/utils';

interface MediaFileWithMetadata extends MediaFile {
  folder?: string;
  tags: string[];
  description?: string;
  downloadCount: number;
  isPublic: boolean;
  cdnUrl?: string;
  thumbnailUrl?: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  transcoding?: {
    progress: number;
    formats: string[];
    status: 'pending' | 'processing' | 'completed' | 'failed';
  };
}

interface UploadProgress {
  file: File;
  progress: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  id: string;
}

interface StorageStats {
  used: number;
  total: number;
  bandwidth: number;
  requests: number;
}

export function MediaManager() {
  const [files, setFiles] = useState<MediaFileWithMetadata[]>([
    {
      id: '1',
      filename: 'course-intro.mp4',
      originalName: 'Course Introduction Video.mp4',
      mimeType: 'video/mp4',
      size: 25600000,
      url: '/uploads/videos/course-intro.mp4',
      uploadedBy: 'instructor-1',
      createdAt: new Date('2024-01-15'),
      folder: 'videos/courses',
      tags: ['course', 'introduction', 'video'],
      description: 'Introduction video for React fundamentals course',
      downloadCount: 145,
      isPublic: true,
      cdnUrl: 'https://cdn.example.com/videos/course-intro.mp4',
      thumbnailUrl: '/thumbnails/course-intro.jpg',
      processingStatus: 'completed',
      transcoding: {
        progress: 100,
        formats: ['mp4', 'webm', 'hls'],
        status: 'completed'
      }
    },
    {
      id: '2',
      filename: 'lesson-slides.pdf',
      originalName: 'React Components Lesson Slides.pdf',
      mimeType: 'application/pdf',
      size: 2400000,
      url: '/uploads/documents/lesson-slides.pdf',
      uploadedBy: 'instructor-2',
      createdAt: new Date('2024-01-18'),
      folder: 'documents/lessons',
      tags: ['slides', 'react', 'components'],
      description: 'Presentation slides for React components lesson',
      downloadCount: 89,
      isPublic: false,
      cdnUrl: 'https://cdn.example.com/docs/lesson-slides.pdf',
      processingStatus: 'completed'
    },
    {
      id: '3',
      filename: 'demo-app-recording.mp4',
      originalName: 'Demo Application Recording.mp4',
      mimeType: 'video/mp4',
      size: 45800000,
      url: '/uploads/videos/demo-app-recording.mp4',
      uploadedBy: 'instructor-1',
      createdAt: new Date('2024-01-20'),
      folder: 'videos/demos',
      tags: ['demo', 'application', 'tutorial'],
      downloadCount: 203,
      isPublic: true,
      processingStatus: 'processing',
      transcoding: {
        progress: 65,
        formats: ['mp4'],
        status: 'processing'
      }
    }
  ]);

  const [selectedFiles, setSelectedFiles] = useState<MediaFileWithMetadata[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [currentFolder, setCurrentFolder] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [storageStats, setStorageStats] = useState<StorageStats>({
    used: 1280000000, // 1.28 GB
    total: 5368709120, // 5 GB
    bandwidth: 45600000, // 45.6 MB this month
    requests: 12450 // API requests this month
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileIcon = (mimeType: string, size: number = 20) => {
    const className = `h-${size === 20 ? 5 : 4} w-${size === 20 ? 5 : 4}`;
    
    if (mimeType.startsWith('image/')) {
      return <Image className={className} />;
    } else if (mimeType.startsWith('video/')) {
      return <Video className={className} />;
    } else if (mimeType.startsWith('audio/')) {
      return <Music className={className} />;
    } else if (mimeType === 'application/pdf') {
      return <FileText className={`${className} text-red-500`} />;
    } else if (mimeType.includes('zip') || mimeType.includes('rar')) {
      return <Archive className={className} />;
    } else {
      return <File className={className} />;
    }
  };

  const getStatusBadge = (status: MediaFileWithMetadata['processingStatus']) => {
    const variants = {
      pending: { className: 'bg-gray-100 text-gray-800', icon: <Clock className="h-3 w-3" /> },
      processing: { className: 'bg-blue-100 text-blue-800', icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
      completed: { className: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-3 w-3" /> },
      failed: { className: 'bg-red-100 text-red-800', icon: <AlertCircle className="h-3 w-3" /> }
    };

    const variant = variants[status];
    
    return (
      <Badge className={`${variant.className} flex items-center space-x-1`}>
        {variant.icon}
        <span>{status}</span>
      </Badge>
    );
  };

  const folders = [
    'videos/courses',
    'videos/demos',
    'documents/lessons',
    'documents/resources',
    'images/thumbnails',
    'images/ui'
  ];

  const filteredFiles = files.filter(file => {
    const matchesSearch = !searchQuery || 
      file.originalName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesType = !filterType || file.mimeType.startsWith(filterType);
    const matchesFolder = !currentFolder || file.folder === currentFolder;
    
    return matchesSearch && matchesType && matchesFolder;
  });

  const handleFileUpload = useCallback(async (files: FileList) => {
    if (!files.length) return;

    setIsUploading(true);
    const newUploads: UploadProgress[] = Array.from(files).map(file => ({
      file,
      progress: 0,
      status: 'uploading' as const,
      id: Math.random().toString(36).substr(2, 9)
    }));

    setUploadProgress(prev => [...prev, ...newUploads]);

    // Simulate upload progress
    for (const upload of newUploads) {
      const interval = setInterval(() => {
        setUploadProgress(prev => prev.map(p => 
          p.id === upload.id && p.progress < 100 
            ? { ...p, progress: Math.min(p.progress + Math.random() * 15, 100) }
            : p
        ));
      }, 200);

      // Simulate upload completion after random time
      setTimeout(() => {
        clearInterval(interval);
        setUploadProgress(prev => prev.map(p => 
          p.id === upload.id 
            ? { ...p, progress: 100, status: 'completed' as const }
            : p
        ));

        // Add to files list
        const newFile: MediaFileWithMetadata = {
          id: upload.id,
          filename: upload.file.name.replace(/[^a-zA-Z0-9.-]/g, '_'),
          originalName: upload.file.name,
          mimeType: upload.file.type,
          size: upload.file.size,
          url: `/uploads/${upload.file.name}`,
          uploadedBy: 'current-user',
          createdAt: new Date(),
          folder: currentFolder,
          tags: [],
          downloadCount: 0,
          isPublic: false,
          processingStatus: upload.file.type.startsWith('video/') ? 'pending' : 'completed'
        };

        setFiles(prev => [...prev, newFile]);

        // Remove from upload progress after delay
        setTimeout(() => {
          setUploadProgress(prev => prev.filter(p => p.id !== upload.id));
        }, 2000);
      }, 2000 + Math.random() * 3000);
    }

    setTimeout(() => setIsUploading(false), 1000);
  }, [currentFolder]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  }, [handleFileUpload]);

  const handleDeleteFile = (file: MediaFileWithMetadata) => {
    if (confirm(`Are you sure you want to delete "${file.originalName}"?`)) {
      setFiles(prev => prev.filter(f => f.id !== file.id));
    }
  };

  const handleCopyUrl = (file: MediaFileWithMetadata) => {
    const url = file.cdnUrl || file.url;
    navigator.clipboard.writeText(url);
    // TODO: Show toast notification
  };

  const handleTogglePublic = (file: MediaFileWithMetadata) => {
    setFiles(prev => prev.map(f => 
      f.id === file.id ? { ...f, isPublic: !f.isPublic } : f
    ));
  };

  const columns = [
    createSelectionColumn(),
    {
      accessorKey: 'originalName',
      header: createSortableHeader('Name'),
      cell: ({ row }: { row: any }) => {
        const file = row.original;
        return (
          <div className="flex items-center space-x-3">
            {file.thumbnailUrl ? (
              <img 
                src={file.thumbnailUrl} 
                alt={file.originalName}
                className="w-10 h-10 rounded object-cover"
              />
            ) : (
              <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center">
                {getFileIcon(file.mimeType)}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-medium truncate">{file.originalName}</p>
              <p className="text-sm text-gray-500">{file.folder}</p>
            </div>
          </div>
        );
      }
    },
    {
      accessorKey: 'mimeType',
      header: createSortableHeader('Type'),
      cell: ({ row }: { row: any }) => {
        const type = row.getValue('mimeType') as string;
        return (
          <Badge variant="outline">
            {type.split('/')[0]}
          </Badge>
        );
      }
    },
    {
      accessorKey: 'size',
      header: createSortableHeader('Size'),
      cell: ({ row }: { row: any }) => {
        const size = row.getValue('size') as number;
        return formatFileSize(size);
      }
    },
    {
      accessorKey: 'processingStatus',
      header: 'Status',
      cell: ({ row }: { row: any }) => {
        const file = row.original;
        return getStatusBadge(file.processingStatus);
      }
    },
    {
      accessorKey: 'downloadCount',
      header: createSortableHeader('Downloads'),
      cell: ({ row }: { row: any }) => {
        const count = row.getValue('downloadCount') as number;
        return count.toLocaleString();
      }
    },
    {
      accessorKey: 'createdAt',
      header: createSortableHeader('Uploaded'),
      cell: ({ row }: { row: any }) => {
        const date = row.getValue('createdAt') as Date;
        return formatDate(date);
      }
    },
    createActionColumn((file: MediaFileWithMetadata) => (
      <>
        <DropdownMenuItem onClick={() => window.open(file.cdnUrl || file.url, '_blank')}>
          <Eye className="mr-2 h-4 w-4" />
          Preview
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleCopyUrl(file)}>
          <Copy className="mr-2 h-4 w-4" />
          Copy URL
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleTogglePublic(file)}>
          <LinkIcon className="mr-2 h-4 w-4" />
          {file.isPublic ? 'Make Private' : 'Make Public'}
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Edit3 className="mr-2 h-4 w-4" />
          Edit Metadata
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Download className="mr-2 h-4 w-4" />
          Download
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleDeleteFile(file)}
          className="text-red-600"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </>
    ))
  ];

  const usagePercentage = (storageStats.used / storageStats.total) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Media Manager</h2>
          <p className="text-gray-600 mt-1">
            Upload, organize, and manage your course media files
          </p>
        </div>
        <div className="flex space-x-4">
          <Button 
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
          />
        </div>
      </div>

      {/* Storage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Storage Used</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatFileSize(storageStats.used)}
                </p>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full" 
                    style={{ width: `${usagePercentage}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {formatFileSize(storageStats.total)} total
                </p>
              </div>
              <HardDrive className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Files</p>
                <p className="text-2xl font-bold text-gray-900">{files.length}</p>
                <p className="text-sm text-green-600 mt-1">
                  +{uploadProgress.length} uploading
                </p>
              </div>
              <File className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Bandwidth Used</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatFileSize(storageStats.bandwidth)}
                </p>
                <p className="text-sm text-gray-500 mt-1">This month</p>
              </div>
              <Zap className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">CDN Requests</p>
                <p className="text-2xl font-bold text-gray-900">
                  {storageStats.requests.toLocaleString()}
                </p>
                <p className="text-sm text-gray-500 mt-1">This month</p>
              </div>
              <CloudUpload className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upload Progress */}
      {uploadProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Upload className="h-5 w-5 mr-2" />
              Upload Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {uploadProgress.map(upload => (
                <div key={upload.id} className="flex items-center space-x-4">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{upload.file.name}</span>
                      <span className="text-sm text-gray-500">
                        {upload.progress.toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          upload.status === 'completed' ? 'bg-green-500' :
                          upload.status === 'failed' ? 'bg-red-500' :
                          'bg-blue-500'
                        }`}
                        style={{ width: `${upload.progress}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center">
                    {upload.status === 'completed' && <CheckCircle className="h-5 w-5 text-green-500" />}
                    {upload.status === 'failed' && <AlertCircle className="h-5 w-5 text-red-500" />}
                    {upload.status === 'uploading' && <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="files" className="space-y-6">
        <TabsList>
          <TabsTrigger value="files">All Files</TabsTrigger>
          <TabsTrigger value="folders">Folders</TabsTrigger>
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="settings">CDN Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="space-y-6">
          {/* Filters */}
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center space-x-2">
                  <Search className="h-4 w-4 text-gray-500" />
                  <Input
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-64"
                  />
                </div>

                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Types</SelectItem>
                    <SelectItem value="image">Images</SelectItem>
                    <SelectItem value="video">Videos</SelectItem>
                    <SelectItem value="audio">Audio</SelectItem>
                    <SelectItem value="application">Documents</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={currentFolder} onValueChange={setCurrentFolder}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="All Folders" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Folders</SelectItem>
                    {folders.map(folder => (
                      <SelectItem key={folder} value={folder}>{folder}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {(filterType || currentFolder || searchQuery) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFilterType('');
                      setCurrentFolder('');
                      setSearchQuery('');
                    }}
                  >
                    Clear Filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Drag & Drop Upload Area */}
          <Card
            className="border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <CardContent className="p-12">
              <div className="text-center">
                <CloudUpload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900">
                  Drop files here to upload
                </p>
                <p className="text-gray-500 mt-2">
                  or{' '}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-600 hover:text-blue-700 underline"
                  >
                    browse your computer
                  </button>
                </p>
                <p className="text-sm text-gray-400 mt-2">
                  Supports images, videos, documents, and audio files up to 100MB
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Files Table */}
          <DataTable
            columns={columns}
            data={filteredFiles}
            onRowSelect={setSelectedFiles}
            searchKey="originalName"
            searchPlaceholder="Search files..."
            customActions={
              selectedFiles.length > 0 ? (
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Download Selected
                  </Button>
                  <Button variant="outline" size="sm">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Selected
                  </Button>
                </div>
              ) : null
            }
          />
        </TabsContent>

        <TabsContent value="folders" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center">
                  <Folder className="h-5 w-5 mr-2" />
                  Folders
                </CardTitle>
                <Button>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  New Folder
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {folders.map(folder => {
                  const folderFiles = files.filter(f => f.folder === folder);
                  const folderSize = folderFiles.reduce((acc, f) => acc + f.size, 0);
                  
                  return (
                    <div 
                      key={folder}
                      className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer"
                      onClick={() => setCurrentFolder(folder)}
                    >
                      <div className="flex items-center space-x-3">
                        <Folder className="h-8 w-8 text-blue-500" />
                        <div>
                          <p className="font-medium">{folder}</p>
                          <p className="text-sm text-gray-500">
                            {folderFiles.length} files • {formatFileSize(folderSize)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="processing" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <RefreshCw className="h-5 w-5 mr-2" />
                File Processing Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {files
                  .filter(f => f.processingStatus !== 'completed')
                  .map(file => (
                    <div key={file.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-4">
                        {getFileIcon(file.mimeType)}
                        <div>
                          <p className="font-medium">{file.originalName}</p>
                          <p className="text-sm text-gray-500">{file.folder}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4">
                        {file.transcoding && (
                          <div className="w-32">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span>Transcoding</span>
                              <span>{file.transcoding.progress}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full"
                                style={{ width: `${file.transcoding.progress}%` }}
                              />
                            </div>
                          </div>
                        )}
                        
                        {getStatusBadge(file.processingStatus)}
                        
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                }
                
                {files.filter(f => f.processingStatus !== 'completed').length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>All files have been processed successfully</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Settings className="h-5 w-5 mr-2" />
                CDN & Storage Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-4">CDN Configuration</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">CDN Domain</label>
                    <Input 
                      defaultValue="cdn.example.com"
                      placeholder="Enter your CDN domain"
                    />
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" defaultChecked />
                    <label className="text-sm">Enable automatic optimization</label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" defaultChecked />
                    <label className="text-sm">Generate WebP variants for images</label>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-lg font-medium mb-4">Video Transcoding</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Output Formats</label>
                    <div className="space-y-2">
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" defaultChecked />
                        <span className="text-sm">MP4 (H.264)</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" defaultChecked />
                        <span className="text-sm">WebM (VP9)</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" />
                        <span className="text-sm">HLS (Adaptive Streaming)</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-lg font-medium mb-4">Storage Limits</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Max File Size</label>
                    <Select defaultValue="100">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 MB</SelectItem>
                        <SelectItem value="50">50 MB</SelectItem>
                        <SelectItem value="100">100 MB</SelectItem>
                        <SelectItem value="500">500 MB</SelectItem>
                        <SelectItem value="1000">1 GB</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2">Retention Policy</label>
                    <Select defaultValue="forever">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 days</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                        <SelectItem value="365">1 year</SelectItem>
                        <SelectItem value="forever">Forever</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              
              <div className="pt-4">
                <Button>Save Settings</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}