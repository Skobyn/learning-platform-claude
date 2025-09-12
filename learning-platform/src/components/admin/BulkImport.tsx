'use client';

import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  DataTable, 
  createSortableHeader, 
  createActionColumn 
} from '@/components/ui/DataTable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Users,
  BookOpen,
  CheckCircle,
  AlertTriangle,
  X,
  Download,
  Play,
  RotateCcw,
  Eye,
  MapPin,
  RefreshCw,
  FileX,
  ArrowRight,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Clock,
  Database,
} from 'lucide-react';
import { User, Course, UserRole, CourseLevel } from '@/types';

interface ImportFile {
  id: string;
  name: string;
  size: number;
  type: 'csv' | 'xlsx' | 'json';
  status: 'uploaded' | 'parsing' | 'validating' | 'mapping' | 'importing' | 'completed' | 'error';
  progress: number;
  recordCount?: number;
  validRecords?: number;
  invalidRecords?: number;
  errors?: ImportError[];
  uploadedAt: Date;
}

interface ImportError {
  row: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

interface ImportTemplate {
  id: string;
  name: string;
  description: string;
  type: 'users' | 'courses' | 'enrollments';
  fields: TemplateField[];
  sampleData: Record<string, any>[];
}

interface TemplateField {
  key: string;
  label: string;
  type: 'string' | 'email' | 'number' | 'date' | 'enum';
  required: boolean;
  options?: string[];
  validation?: string;
  example?: string;
}

interface FieldMapping {
  sourceField: string;
  targetField: string;
  transform?: string;
}

export function BulkImport() {
  const [importFiles, setImportFiles] = useState<ImportFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ImportFile | null>(null);
  const [importType, setImportType] = useState<'users' | 'courses' | 'enrollments'>('users');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [previewData, setPreviewData] = useState<Record<string, any>[]>([]);
  const [sourceFields, setSourceFields] = useState<string[]>([]);
  const [validationResults, setValidationResults] = useState<ImportError[]>([]);
  const [importing, setImporting] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import templates for different data types
  const importTemplates: ImportTemplate[] = [
    {
      id: 'users-template',
      name: 'Users Import Template',
      description: 'Import users with roles and profile information',
      type: 'users',
      fields: [
        { key: 'email', label: 'Email Address', type: 'email', required: true, example: 'john.doe@company.com' },
        { key: 'firstName', label: 'First Name', type: 'string', required: true, example: 'John' },
        { key: 'lastName', label: 'Last Name', type: 'string', required: true, example: 'Doe' },
        { key: 'role', label: 'Role', type: 'enum', required: true, options: Object.values(UserRole), example: 'learner' },
        { key: 'department', label: 'Department', type: 'string', required: false, example: 'Engineering' },
      ],
      sampleData: [
        { email: 'john.doe@company.com', firstName: 'John', lastName: 'Doe', role: 'learner', department: 'Engineering' },
        { email: 'jane.smith@company.com', firstName: 'Jane', lastName: 'Smith', role: 'instructor', department: 'Product' },
        { email: 'mike.wilson@company.com', firstName: 'Mike', lastName: 'Wilson', role: 'learner', department: 'Marketing' }
      ]
    },
    {
      id: 'courses-template',
      name: 'Courses Import Template',
      description: 'Import courses with metadata and settings',
      type: 'courses',
      fields: [
        { key: 'title', label: 'Course Title', type: 'string', required: true, example: 'Introduction to React' },
        { key: 'description', label: 'Description', type: 'string', required: true, example: 'Learn React fundamentals' },
        { key: 'level', label: 'Difficulty Level', type: 'enum', required: true, options: Object.values(CourseLevel), example: 'beginner' },
        { key: 'duration', label: 'Duration (minutes)', type: 'number', required: true, example: '120' },
        { key: 'instructorEmail', label: 'Instructor Email', type: 'email', required: true, example: 'instructor@company.com' },
        { key: 'tags', label: 'Tags (comma-separated)', type: 'string', required: false, example: 'javascript,react,frontend' },
      ],
      sampleData: [
        { title: 'Introduction to React', description: 'Learn React fundamentals', level: 'beginner', duration: 120, instructorEmail: 'jane@company.com', tags: 'javascript,react,frontend' },
        { title: 'Advanced Node.js', description: 'Master backend development', level: 'advanced', duration: 180, instructorEmail: 'john@company.com', tags: 'nodejs,backend,api' }
      ]
    },
    {
      id: 'enrollments-template',
      name: 'Enrollments Import Template',
      description: 'Bulk enroll users into courses',
      type: 'enrollments',
      fields: [
        { key: 'userEmail', label: 'User Email', type: 'email', required: true, example: 'user@company.com' },
        { key: 'courseTitle', label: 'Course Title', type: 'string', required: true, example: 'Introduction to React' },
        { key: 'enrollmentDate', label: 'Enrollment Date', type: 'date', required: false, example: '2024-01-15' },
      ],
      sampleData: [
        { userEmail: 'john@company.com', courseTitle: 'Introduction to React', enrollmentDate: '2024-01-15' },
        { userEmail: 'jane@company.com', courseTitle: 'Advanced Node.js', enrollmentDate: '2024-01-16' }
      ]
    }
  ];

  const currentTemplate = importTemplates.find(t => t.type === importType);

  const handleFileUpload = useCallback(async (files: FileList) => {
    if (!files.length) return;

    for (const file of Array.from(files)) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      if (!['csv', 'xlsx', 'json'].includes(fileExtension || '')) {
        alert('Please upload CSV, XLSX, or JSON files only.');
        continue;
      }

      const importFile: ImportFile = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        type: fileExtension as 'csv' | 'xlsx' | 'json',
        status: 'uploaded',
        progress: 0,
        uploadedAt: new Date()
      };

      setImportFiles(prev => [...prev, importFile]);

      // Simulate file parsing
      setTimeout(() => {
        setImportFiles(prev => prev.map(f => 
          f.id === importFile.id 
            ? { ...f, status: 'parsing', progress: 20 }
            : f
        ));

        // Simulate parsing completion
        setTimeout(() => {
          const mockSourceFields = ['email', 'first_name', 'last_name', 'role', 'department', 'hire_date'];
          const mockPreviewData = [
            { email: 'john.doe@company.com', first_name: 'John', last_name: 'Doe', role: 'learner', department: 'Engineering', hire_date: '2024-01-15' },
            { email: 'jane.smith@company.com', first_name: 'Jane', last_name: 'Smith', role: 'instructor', department: 'Product', hire_date: '2024-01-10' },
            { email: 'invalid-email', first_name: '', last_name: 'Wilson', role: 'admin', department: 'HR', hire_date: '2024-01-12' }
          ];

          setSourceFields(mockSourceFields);
          setPreviewData(mockPreviewData);
          
          setImportFiles(prev => prev.map(f => 
            f.id === importFile.id 
              ? { 
                  ...f, 
                  status: 'mapping', 
                  progress: 50,
                  recordCount: mockPreviewData.length,
                  validRecords: 2,
                  invalidRecords: 1
                }
              : f
          ));
        }, 2000);
      }, 1000);
    }
  }, []);

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

  const handleValidation = () => {
    if (!selectedFile) return;

    setImportFiles(prev => prev.map(f => 
      f.id === selectedFile.id 
        ? { ...f, status: 'validating', progress: 60 }
        : f
    ));

    // Simulate validation
    setTimeout(() => {
      const mockErrors: ImportError[] = [
        { row: 3, field: 'email', message: 'Invalid email format', severity: 'error' },
        { row: 3, field: 'firstName', message: 'First name is required', severity: 'error' },
        { row: 2, field: 'department', message: 'Department not found', severity: 'warning' }
      ];

      setValidationResults(mockErrors);
      
      setImportFiles(prev => prev.map(f => 
        f.id === selectedFile.id 
          ? { 
              ...f, 
              status: 'mapping', 
              progress: 80,
              errors: mockErrors,
              validRecords: f.recordCount! - 1,
              invalidRecords: 1
            }
          : f
      ));
    }, 2000);
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setImporting(true);
    setImportFiles(prev => prev.map(f => 
      f.id === selectedFile.id 
        ? { ...f, status: 'importing', progress: 90 }
        : f
    ));

    // Simulate import process
    setTimeout(() => {
      setImportFiles(prev => prev.map(f => 
        f.id === selectedFile.id 
          ? { ...f, status: 'completed', progress: 100 }
          : f
      ));
      setImporting(false);
    }, 3000);
  };

  const downloadTemplate = (template: ImportTemplate) => {
    const headers = template.fields.map(f => f.key);
    const rows = template.sampleData.map(data => 
      headers.map(header => data[header] || '').join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status: ImportFile['status']) => {
    switch (status) {
      case 'uploaded':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'parsing':
      case 'validating':
      case 'importing':
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'mapping':
        return <MapPin className="h-4 w-4 text-orange-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const fileColumns = [
    {
      accessorKey: 'name',
      header: 'File Name',
      cell: ({ row }: { row: any }) => {
        const file = row.original;
        return (
          <div className="flex items-center space-x-3">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-gray-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB • {file.type.toUpperCase()}
              </p>
            </div>
          </div>
        );
      }
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }: { row: any }) => {
        const file = row.original;
        return (
          <div className="flex items-center space-x-2">
            {getStatusIcon(file.status)}
            <span className="capitalize">{file.status.replace('_', ' ')}</span>
          </div>
        );
      }
    },
    {
      accessorKey: 'progress',
      header: 'Progress',
      cell: ({ row }: { row: any }) => {
        const file = row.original;
        return (
          <div className="w-full">
            <div className="flex justify-between text-sm mb-1">
              <span>{file.progress}%</span>
              {file.recordCount && (
                <span>{file.recordCount} records</span>
              )}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${file.progress}%` }}
              />
            </div>
          </div>
        );
      }
    },
    {
      accessorKey: 'validRecords',
      header: 'Results',
      cell: ({ row }: { row: any }) => {
        const file = row.original;
        if (!file.recordCount) return '—';
        
        return (
          <div className="text-sm">
            <div className="flex items-center space-x-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              <span>{file.validRecords || 0} valid</span>
            </div>
            {file.invalidRecords > 0 && (
              <div className="flex items-center space-x-1">
                <AlertCircle className="h-3 w-3 text-red-500" />
                <span>{file.invalidRecords} errors</span>
              </div>
            )}
          </div>
        );
      }
    },
    createActionColumn((file: ImportFile) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setSelectedFile(file)}
        disabled={file.status === 'uploaded' || file.status === 'parsing'}
      >
        <Eye className="h-4 w-4 mr-2" />
        {file.status === 'completed' ? 'View Results' : 'Configure'}
      </Button>
    ))
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Bulk Import</h2>
          <p className="text-gray-600 mt-1">
            Import users, courses, and enrollments from CSV, Excel, or JSON files
          </p>
        </div>
      </div>

      {/* Import Type Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Database className="h-5 w-5 mr-2" />
            Import Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <div>
              <label className="block text-sm font-medium mb-2">Import Type</label>
              <Select value={importType} onValueChange={(value: any) => setImportType(value)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="users">
                    <div className="flex items-center">
                      <Users className="h-4 w-4 mr-2" />
                      Users
                    </div>
                  </SelectItem>
                  <SelectItem value="courses">
                    <div className="flex items-center">
                      <BookOpen className="h-4 w-4 mr-2" />
                      Courses
                    </div>
                  </SelectItem>
                  <SelectItem value="enrollments">
                    <div className="flex items-center">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Enrollments
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {currentTemplate && (
              <div>
                <label className="block text-sm font-medium mb-2">Template</label>
                <Button variant="outline" onClick={() => downloadTemplate(currentTemplate)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="upload" className="space-y-6">
        <TabsList>
          <TabsTrigger value="upload">Upload Files</TabsTrigger>
          <TabsTrigger value="mapping">Field Mapping</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
          <TabsTrigger value="history">Import History</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-6">
          {/* Upload Area */}
          <Card
            className="border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <CardContent className="p-12">
              <div className="text-center">
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-900">
                  Drop your files here to upload
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
                  Supports CSV, Excel (.xlsx), and JSON files up to 50MB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.json"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Template Information */}
          {currentTemplate && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <FileText className="h-5 w-5 mr-2" />
                  {currentTemplate.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 mb-4">{currentTemplate.description}</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-3">Required Fields</h4>
                    <div className="space-y-2">
                      {currentTemplate.fields.map(field => (
                        <div key={field.key} className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium">{field.label}</span>
                            {field.required && (
                              <Badge className="bg-red-100 text-red-800" size="sm">Required</Badge>
                            )}
                          </div>
                          <span className="text-sm text-gray-500">{field.example}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-3">Sample Data</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            {currentTemplate.fields.slice(0, 3).map(field => (
                              <th key={field.key} className="text-left py-1 px-2">{field.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentTemplate.sampleData.slice(0, 2).map((row, index) => (
                            <tr key={index} className="border-b">
                              {currentTemplate.fields.slice(0, 3).map(field => (
                                <td key={field.key} className="py-1 px-2 text-gray-600">
                                  {row[field.key]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Files Table */}
          {importFiles.length > 0 && (
            <DataTable
              columns={fileColumns}
              data={importFiles}
              title="Uploaded Files"
              description="Manage your uploaded import files"
            />
          )}
        </TabsContent>

        <TabsContent value="mapping" className="space-y-6">
          {selectedFile && currentTemplate ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <MapPin className="h-5 w-5 mr-2" />
                  Field Mapping - {selectedFile.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 text-sm font-medium text-gray-600 border-b pb-2">
                    <div>Source Field</div>
                    <div className="text-center">
                      <ArrowRight className="h-4 w-4 mx-auto" />
                    </div>
                    <div>Target Field</div>
                  </div>
                  
                  {currentTemplate.fields.map(targetField => {
                    const mapping = fieldMappings.find(m => m.targetField === targetField.key);
                    
                    return (
                      <div key={targetField.key} className="grid grid-cols-3 gap-4 items-center">
                        <div>
                          <Select
                            value={mapping?.sourceField || ''}
                            onValueChange={(value) => {
                              setFieldMappings(prev => {
                                const filtered = prev.filter(m => m.targetField !== targetField.key);
                                return value ? [...filtered, { sourceField: value, targetField: targetField.key }] : filtered;
                              });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select source field" />
                            </SelectTrigger>
                            <SelectContent>
                              {sourceFields.map(field => (
                                <SelectItem key={field} value={field}>{field}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="text-center">
                          <ArrowRight className="h-4 w-4 text-gray-400 mx-auto" />
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">{targetField.label}</span>
                          {targetField.required && (
                            <Badge className="bg-red-100 text-red-800" size="sm">Required</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={handleValidation}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Validate Data
                    </Button>
                    
                    <Button 
                      onClick={handleImport}
                      disabled={fieldMappings.length === 0 || importing}
                    >
                      {importing ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Start Import
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-12">
                <div className="text-center text-gray-500">
                  <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select a file from the Upload tab to configure field mappings</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="validation" className="space-y-6">
          {selectedFile && validationResults.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  Validation Results - {selectedFile.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-green-50 rounded">
                      <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-green-700">{selectedFile.validRecords}</p>
                      <p className="text-sm text-green-600">Valid Records</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 rounded">
                      <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-red-700">{selectedFile.invalidRecords}</p>
                      <p className="text-sm text-red-600">Invalid Records</p>
                    </div>
                    <div className="text-center p-4 bg-blue-50 rounded">
                      <Info className="h-8 w-8 text-blue-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-blue-700">{selectedFile.recordCount}</p>
                      <p className="text-sm text-blue-600">Total Records</p>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-3">Validation Errors</h4>
                    <div className="space-y-2">
                      {validationResults.map((error, index) => (
                        <div 
                          key={index} 
                          className={`flex items-center space-x-3 p-3 rounded border ${
                            error.severity === 'error' 
                              ? 'bg-red-50 border-red-200' 
                              : 'bg-yellow-50 border-yellow-200'
                          }`}
                        >
                          {error.severity === 'error' ? (
                            <XCircle className="h-5 w-5 text-red-500" />
                          ) : (
                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                          )}
                          <div className="flex-1">
                            <p className={`font-medium ${
                              error.severity === 'error' ? 'text-red-800' : 'text-yellow-800'
                            }`}>
                              Row {error.row}: {error.message}
                            </p>
                            <p className={`text-sm ${
                              error.severity === 'error' ? 'text-red-600' : 'text-yellow-600'
                            }`}>
                              Field: {error.field}
                            </p>
                          </div>
                          <Badge className={
                            error.severity === 'error' 
                              ? 'bg-red-100 text-red-800' 
                              : 'bg-yellow-100 text-yellow-800'
                          }>
                            {error.severity}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="pt-4">
                    <Button onClick={handleImport} disabled={selectedFile.invalidRecords > 0}>
                      <Play className="h-4 w-4 mr-2" />
                      Import Valid Records Only
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-12">
                <div className="text-center text-gray-500">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No validation results available</p>
                  <p className="text-sm">Upload and configure a file to see validation results</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                Import History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {importFiles.filter(f => f.status === 'completed').map(file => (
                  <div key={file.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <CheckCircle className="h-8 w-8 text-green-500" />
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-gray-500">
                          Imported {file.validRecords} records • {file.uploadedAt.toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Export Report
                      </Button>
                    </div>
                  </div>
                ))}
                
                {importFiles.filter(f => f.status === 'completed').length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No completed imports yet</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}