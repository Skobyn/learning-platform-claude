'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  DataTable, 
  createSortableHeader, 
  createActionColumn 
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
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FileBarChart,
  Plus,
  Download,
  Calendar,
  Clock,
  Filter,
  Settings,
  Eye,
  Edit3,
  Trash2,
  Copy,
  Play,
  BarChart3,
  PieChart,
  TrendingUp,
  Users,
  BookOpen,
  Target,
  DollarSign,
  Activity,
  Mail,
  RefreshCw,
  Save,
  FileText,
  Table,
  Image,
  Zap,
  Database,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  category: 'users' | 'courses' | 'performance' | 'financial' | 'engagement';
  type: 'table' | 'chart' | 'dashboard';
  fields: ReportField[];
  filters: ReportFilter[];
  schedule?: ReportSchedule;
  createdBy: string;
  createdAt: Date;
  lastRun?: Date;
  isActive: boolean;
}

interface ReportField {
  id: string;
  label: string;
  dataSource: string;
  aggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  format?: 'number' | 'currency' | 'percentage' | 'date';
  sortable: boolean;
  visible: boolean;
}

interface ReportFilter {
  id: string;
  label: string;
  field: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect';
  options?: string[];
  defaultValue?: any;
  required: boolean;
}

interface ReportSchedule {
  frequency: 'once' | 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  time: string; // HH:MM format
  recipients: string[];
  format: 'pdf' | 'xlsx' | 'csv';
  isActive: boolean;
}

interface GeneratedReport {
  id: string;
  templateId: string;
  templateName: string;
  generatedBy: string;
  generatedAt: Date;
  status: 'generating' | 'completed' | 'failed';
  format: 'pdf' | 'xlsx' | 'csv' | 'html';
  fileSize?: number;
  downloadUrl?: string;
  parameters: Record<string, any>;
}

export function ReportGenerator() {
  const [reports, setReports] = useState<ReportTemplate[]>([
    {
      id: '1',
      name: 'User Engagement Report',
      description: 'Comprehensive analysis of user activity and engagement metrics',
      category: 'engagement',
      type: 'dashboard',
      fields: [
        { id: 'f1', label: 'User Name', dataSource: 'users.name', sortable: true, visible: true },
        { id: 'f2', label: 'Login Count', dataSource: 'user_sessions.count', aggregation: 'count', format: 'number', sortable: true, visible: true },
        { id: 'f3', label: 'Course Completions', dataSource: 'enrollments.completed', aggregation: 'count', format: 'number', sortable: true, visible: true },
        { id: 'f4', label: 'Avg Session Time', dataSource: 'user_sessions.duration', aggregation: 'avg', format: 'number', sortable: true, visible: true }
      ],
      filters: [
        { id: 'f1', label: 'Date Range', field: 'created_at', type: 'date', required: true },
        { id: 'f2', label: 'Department', field: 'users.department', type: 'multiselect', options: ['Engineering', 'Product', 'Sales', 'Marketing'], required: false }
      ],
      createdBy: 'admin',
      createdAt: new Date('2024-01-15'),
      lastRun: new Date('2024-01-20'),
      isActive: true
    },
    {
      id: '2',
      name: 'Course Performance Analytics',
      description: 'Detailed performance metrics for all courses',
      category: 'courses',
      type: 'table',
      fields: [
        { id: 'f1', label: 'Course Title', dataSource: 'courses.title', sortable: true, visible: true },
        { id: 'f2', label: 'Enrollments', dataSource: 'enrollments.count', aggregation: 'count', format: 'number', sortable: true, visible: true },
        { id: 'f3', label: 'Completion Rate', dataSource: 'enrollments.completion_rate', format: 'percentage', sortable: true, visible: true },
        { id: 'f4', label: 'Average Rating', dataSource: 'course_ratings.rating', aggregation: 'avg', format: 'number', sortable: true, visible: true },
        { id: 'f5', label: 'Revenue', dataSource: 'payments.amount', aggregation: 'sum', format: 'currency', sortable: true, visible: true }
      ],
      filters: [
        { id: 'f1', label: 'Course Level', field: 'courses.level', type: 'select', options: ['Beginner', 'Intermediate', 'Advanced'], required: false },
        { id: 'f2', label: 'Instructor', field: 'courses.instructor_id', type: 'select', required: false }
      ],
      createdBy: 'admin',
      createdAt: new Date('2024-01-10'),
      lastRun: new Date('2024-01-18'),
      isActive: true,
      schedule: {
        frequency: 'weekly',
        dayOfWeek: 1, // Monday
        time: '09:00',
        recipients: ['admin@company.com', 'analytics@company.com'],
        format: 'xlsx',
        isActive: true
      }
    },
    {
      id: '3',
      name: 'Revenue Dashboard',
      description: 'Financial overview and revenue tracking',
      category: 'financial',
      type: 'chart',
      fields: [
        { id: 'f1', label: 'Month', dataSource: 'payments.created_at', format: 'date', sortable: true, visible: true },
        { id: 'f2', label: 'Total Revenue', dataSource: 'payments.amount', aggregation: 'sum', format: 'currency', sortable: true, visible: true },
        { id: 'f3', label: 'Subscription Revenue', dataSource: 'subscriptions.amount', aggregation: 'sum', format: 'currency', sortable: true, visible: true },
        { id: 'f4', label: 'One-time Payments', dataSource: 'one_time_payments.amount', aggregation: 'sum', format: 'currency', sortable: true, visible: true }
      ],
      filters: [
        { id: 'f1', label: 'Date Range', field: 'created_at', type: 'date', required: true },
        { id: 'f2', label: 'Payment Type', field: 'payments.type', type: 'multiselect', options: ['subscription', 'one_time', 'refund'], required: false }
      ],
      createdBy: 'admin',
      createdAt: new Date('2024-01-05'),
      isActive: true
    }
  ]);

  const [generatedReports, setGeneratedReports] = useState<GeneratedReport[]>([
    {
      id: 'gr1',
      templateId: '1',
      templateName: 'User Engagement Report',
      generatedBy: 'admin',
      generatedAt: new Date('2024-01-20T10:30:00'),
      status: 'completed',
      format: 'pdf',
      fileSize: 2457600, // 2.4MB
      downloadUrl: '/reports/user-engagement-20240120.pdf',
      parameters: { dateRange: 'last_30_days', department: ['Engineering', 'Product'] }
    },
    {
      id: 'gr2',
      templateId: '2',
      templateName: 'Course Performance Analytics',
      generatedBy: 'system',
      generatedAt: new Date('2024-01-19T09:00:00'),
      status: 'completed',
      format: 'xlsx',
      fileSize: 1843200, // 1.8MB
      downloadUrl: '/reports/course-performance-20240119.xlsx',
      parameters: { courseLevel: 'all', instructor: 'all' }
    },
    {
      id: 'gr3',
      templateId: '3',
      templateName: 'Revenue Dashboard',
      generatedBy: 'admin',
      generatedAt: new Date('2024-01-18T14:15:00'),
      status: 'generating',
      format: 'pdf',
      parameters: { dateRange: 'this_quarter' }
    }
  ]);

  const [selectedReport, setSelectedReport] = useState<ReportTemplate | null>(null);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  const [reportForm, setReportForm] = useState<Partial<ReportTemplate>>({
    name: '',
    description: '',
    category: 'users',
    type: 'table',
    fields: [],
    filters: [],
    isActive: true
  });

  const availableDataSources = [
    { id: 'users', label: 'Users', icon: <Users className="h-4 w-4" /> },
    { id: 'courses', label: 'Courses', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'enrollments', label: 'Enrollments', icon: <Target className="h-4 w-4" /> },
    { id: 'payments', label: 'Payments', icon: <DollarSign className="h-4 w-4" /> },
    { id: 'user_sessions', label: 'User Sessions', icon: <Activity className="h-4 w-4" /> },
  ];

  const handleCreateReport = () => {
    setSelectedReport(null);
    setReportForm({
      name: '',
      description: '',
      category: 'users',
      type: 'table',
      fields: [],
      filters: [],
      isActive: true
    });
    setShowReportDialog(true);
  };

  const handleEditReport = (report: ReportTemplate) => {
    setSelectedReport(report);
    setReportForm(report);
    setShowReportDialog(true);
  };

  const handleDeleteReport = (report: ReportTemplate) => {
    if (confirm(`Are you sure you want to delete "${report.name}"?`)) {
      setReports(prev => prev.filter(r => r.id !== report.id));
    }
  };

  const handleGenerateReport = async (reportId: string, parameters: Record<string, any> = {}) => {
    const report = reports.find(r => r.id === reportId);
    if (!report) return;

    setGenerating(reportId);

    const newGeneratedReport: GeneratedReport = {
      id: `gr-${Date.now()}`,
      templateId: reportId,
      templateName: report.name,
      generatedBy: 'current-user',
      generatedAt: new Date(),
      status: 'generating',
      format: 'pdf',
      parameters
    };

    setGeneratedReports(prev => [newGeneratedReport, ...prev]);

    // Simulate report generation
    setTimeout(() => {
      setGeneratedReports(prev => prev.map(gr => 
        gr.id === newGeneratedReport.id
          ? {
              ...gr,
              status: 'completed',
              fileSize: Math.floor(Math.random() * 5000000) + 1000000, // 1-5MB
              downloadUrl: `/reports/${report.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.pdf`
            }
          : gr
      ));
      setGenerating(null);
    }, 3000);

    // Update last run time
    setReports(prev => prev.map(r =>
      r.id === reportId ? { ...r, lastRun: new Date() } : r
    ));
  };

  const handleScheduleReport = (report: ReportTemplate) => {
    setSelectedReport(report);
    setShowScheduleDialog(true);
  };

  const handleSaveReport = () => {
    if (!reportForm.name) return;

    const report: ReportTemplate = {
      id: selectedReport?.id || `report-${Date.now()}`,
      name: reportForm.name!,
      description: reportForm.description || '',
      category: reportForm.category!,
      type: reportForm.type!,
      fields: reportForm.fields || [],
      filters: reportForm.filters || [],
      schedule: reportForm.schedule,
      createdBy: 'current-user',
      createdAt: selectedReport?.createdAt || new Date(),
      isActive: reportForm.isActive!
    };

    if (selectedReport) {
      setReports(prev => prev.map(r => r.id === selectedReport.id ? report : r));
    } else {
      setReports(prev => [...prev, report]);
    }

    setShowReportDialog(false);
  };

  const formatFileSize = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  const getStatusBadge = (status: GeneratedReport['status']) => {
    const variants = {
      generating: { className: 'bg-blue-100 text-blue-800', icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
      completed: { className: 'bg-green-100 text-green-800', icon: <Download className="h-3 w-3" /> },
      failed: { className: 'bg-red-100 text-red-800', icon: <Trash2 className="h-3 w-3" /> }
    };

    const variant = variants[status];
    
    return (
      <Badge className={`${variant.className} flex items-center space-x-1`}>
        {variant.icon}
        <span>{status}</span>
      </Badge>
    );
  };

  const getCategoryIcon = (category: ReportTemplate['category']) => {
    const icons = {
      users: <Users className="h-4 w-4" />,
      courses: <BookOpen className="h-4 w-4" />,
      performance: <TrendingUp className="h-4 w-4" />,
      financial: <DollarSign className="h-4 w-4" />,
      engagement: <Activity className="h-4 w-4" />
    };
    return icons[category];
  };

  const getTypeIcon = (type: ReportTemplate['type']) => {
    const icons = {
      table: <Table className="h-4 w-4" />,
      chart: <BarChart3 className="h-4 w-4" />,
      dashboard: <PieChart className="h-4 w-4" />
    };
    return icons[type];
  };

  const reportColumns = [
    {
      accessorKey: 'name',
      header: createSortableHeader('Report Name'),
      cell: ({ row }: { row: any }) => {
        const report = row.original;
        return (
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gray-100 rounded">
              {getCategoryIcon(report.category)}
            </div>
            <div>
              <p className="font-medium">{report.name}</p>
              <p className="text-sm text-gray-500 truncate">{report.description}</p>
            </div>
          </div>
        );
      }
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ row }: { row: any }) => {
        const category = row.getValue('category');
        return (
          <Badge variant="outline" className="capitalize">
            {category}
          </Badge>
        );
      }
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }: { row: any }) => {
        const type = row.getValue('type');
        return (
          <div className="flex items-center space-x-1">
            {getTypeIcon(type)}
            <span className="capitalize">{type}</span>
          </div>
        );
      }
    },
    {
      accessorKey: 'schedule',
      header: 'Schedule',
      cell: ({ row }: { row: any }) => {
        const report = row.original;
        return report.schedule ? (
          <Badge className="bg-blue-100 text-blue-800">
            {report.schedule.frequency}
          </Badge>
        ) : (
          <span className="text-gray-500">Manual</span>
        );
      }
    },
    {
      accessorKey: 'lastRun',
      header: createSortableHeader('Last Run'),
      cell: ({ row }: { row: any }) => {
        const lastRun = row.getValue('lastRun');
        return lastRun ? formatDate(lastRun as Date) : 'Never';
      }
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }: { row: any }) => {
        const isActive = row.getValue('isActive');
        return (
          <Badge className={isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
            {isActive ? 'Active' : 'Inactive'}
          </Badge>
        );
      }
    },
    createActionColumn((report: ReportTemplate) => (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleGenerateReport(report.id)}
          disabled={generating === report.id}
        >
          <Play className="h-4 w-4 mr-2" />
          {generating === report.id ? 'Generating...' : 'Generate'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => handleEditReport(report)}>
          <Edit3 className="h-4 w-4 mr-2" />
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => handleScheduleReport(report)}>
          <Calendar className="h-4 w-4 mr-2" />
          Schedule
        </Button>
        <Button variant="ghost" size="sm">
          <Copy className="h-4 w-4 mr-2" />
          Duplicate
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => handleDeleteReport(report)}
          className="text-red-600"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>
      </>
    ))
  ];

  const generatedReportsColumns = [
    {
      accessorKey: 'templateName',
      header: createSortableHeader('Report Name'),
      cell: ({ row }: { row: any }) => {
        const report = row.original;
        return (
          <div className="flex items-center space-x-3">
            <FileText className="h-5 w-5 text-blue-600" />
            <div>
              <p className="font-medium">{report.templateName}</p>
              <p className="text-sm text-gray-500">
                by {report.generatedBy} • {formatDate(report.generatedAt)}
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
        const status = row.getValue('status');
        return getStatusBadge(status);
      }
    },
    {
      accessorKey: 'format',
      header: 'Format',
      cell: ({ row }: { row: any }) => {
        const format = row.getValue('format');
        return (
          <Badge variant="outline" className="uppercase">
            {format}
          </Badge>
        );
      }
    },
    {
      accessorKey: 'fileSize',
      header: 'Size',
      cell: ({ row }: { row: any }) => {
        const fileSize = row.getValue('fileSize');
        return fileSize ? formatFileSize(fileSize as number) : '—';
      }
    },
    {
      accessorKey: 'generatedAt',
      header: createSortableHeader('Generated'),
      cell: ({ row }: { row: any }) => {
        const date = row.getValue('generatedAt');
        return formatDate(date as Date);
      }
    },
    createActionColumn((report: GeneratedReport) => (
      <>
        {report.status === 'completed' && report.downloadUrl && (
          <Button variant="ghost" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        )}
        <Button variant="ghost" size="sm">
          <Eye className="h-4 w-4 mr-2" />
          View Details
        </Button>
        <Button variant="ghost" size="sm">
          <Mail className="h-4 w-4 mr-2" />
          Email
        </Button>
        <Button variant="ghost" size="sm" className="text-red-600">
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>
      </>
    ))
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Report Generator</h2>
          <p className="text-gray-600 mt-1">
            Create, schedule, and manage custom reports
          </p>
        </div>
        <div className="flex space-x-4">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export All
          </Button>
          <Button onClick={handleCreateReport}>
            <Plus className="h-4 w-4 mr-2" />
            Create Report
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Reports</p>
                <p className="text-3xl font-bold text-gray-900">{reports.length}</p>
              </div>
              <FileBarChart className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Reports</p>
                <p className="text-3xl font-bold text-gray-900">
                  {reports.filter(r => r.isActive).length}
                </p>
              </div>
              <Zap className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Scheduled Reports</p>
                <p className="text-3xl font-bold text-gray-900">
                  {reports.filter(r => r.schedule?.isActive).length}
                </p>
              </div>
              <Calendar className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Generated Today</p>
                <p className="text-3xl font-bold text-gray-900">
                  {generatedReports.filter(gr => 
                    gr.generatedAt.toDateString() === new Date().toDateString()
                  ).length}
                </p>
              </div>
              <Activity className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="templates" className="space-y-6">
        <TabsList>
          <TabsTrigger value="templates">Report Templates</TabsTrigger>
          <TabsTrigger value="generated">Generated Reports</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-6">
          <DataTable
            columns={reportColumns}
            data={reports}
            searchKey="name"
            searchPlaceholder="Search reports..."
          />
        </TabsContent>

        <TabsContent value="generated" className="space-y-6">
          <DataTable
            columns={generatedReportsColumns}
            data={generatedReports}
            searchKey="templateName"
            searchPlaceholder="Search generated reports..."
          />
        </TabsContent>

        <TabsContent value="scheduled" className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            {reports.filter(r => r.schedule?.isActive).map(report => (
              <Card key={report.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="p-3 bg-blue-100 rounded-full">
                        {getCategoryIcon(report.category)}
                      </div>
                      <div>
                        <h3 className="font-medium">{report.name}</h3>
                        <p className="text-sm text-gray-500">{report.description}</p>
                        <div className="flex items-center space-x-4 mt-2">
                          <Badge className="bg-blue-100 text-blue-800">
                            {report.schedule!.frequency}
                          </Badge>
                          <span className="text-sm text-gray-500">
                            Next run: {report.schedule!.frequency === 'daily' ? 'Tomorrow' : 
                                     report.schedule!.frequency === 'weekly' ? 'Next Monday' : 
                                     'Next month'} at {report.schedule!.time}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm">
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit Schedule
                      </Button>
                      <Button variant="outline" size="sm">
                        <Play className="h-4 w-4 mr-2" />
                        Run Now
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {reports.filter(r => r.schedule?.isActive).length === 0 && (
              <Card>
                <CardContent className="p-12">
                  <div className="text-center text-gray-500">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No scheduled reports</p>
                    <p className="text-sm">Create a report and set up a schedule to automate report generation</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Report Creation/Edit Dialog */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedReport ? 'Edit Report' : 'Create New Report'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Report Name</label>
                <Input
                  value={reportForm.name || ''}
                  onChange={(e) => setReportForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter report name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <Select 
                  value={reportForm.category} 
                  onValueChange={(value: any) => setReportForm(prev => ({ ...prev, category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="users">Users</SelectItem>
                    <SelectItem value="courses">Courses</SelectItem>
                    <SelectItem value="performance">Performance</SelectItem>
                    <SelectItem value="financial">Financial</SelectItem>
                    <SelectItem value="engagement">Engagement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <Textarea
                value={reportForm.description || ''}
                onChange={(e) => setReportForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe what this report shows..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Report Type</label>
                <Select 
                  value={reportForm.type} 
                  onValueChange={(value: any) => setReportForm(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="table">Data Table</SelectItem>
                    <SelectItem value="chart">Chart/Graph</SelectItem>
                    <SelectItem value="dashboard">Dashboard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center space-x-2">
                  <Checkbox 
                    checked={reportForm.isActive} 
                    onCheckedChange={(checked) => setReportForm(prev => ({ ...prev, isActive: !!checked }))}
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-3">Data Sources</label>
              <div className="grid grid-cols-2 gap-3">
                {availableDataSources.map(source => (
                  <div key={source.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50">
                    {source.icon}
                    <span className="font-medium">{source.label}</span>
                    <Checkbox />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveReport} disabled={!reportForm.name}>
              <Save className="h-4 w-4 mr-2" />
              {selectedReport ? 'Update Report' : 'Create Report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}