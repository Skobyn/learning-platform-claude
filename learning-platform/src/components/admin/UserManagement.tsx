'use client';

import { useState, useMemo } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Users,
  UserPlus,
  UserX,
  Mail,
  Shield,
  Eye,
  Edit3,
  Trash2,
  Download,
  Upload,
  Filter,
  RefreshCw,
  MoreVertical,
  Ban,
  CheckCircle,
  AlertCircle,
  Calendar,
  Activity,
  Search,
  Settings,
} from 'lucide-react';
import { User, UserRole, EnrollmentStatus } from '@/types';
import { formatDate, getRoleColor } from '@/lib/utils';

interface UserWithStats extends User {
  enrollmentsCount: number;
  completedCourses: number;
  lastActivity: Date;
  status: 'active' | 'inactive' | 'suspended';
}

interface UserDialogData {
  user?: UserWithStats;
  mode: 'create' | 'edit' | 'view';
  isOpen: boolean;
}

interface BulkAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: (users: UserWithStats[]) => void;
  requiresConfirmation?: boolean;
}

export function UserManagement() {
  const [users, setUsers] = useState<UserWithStats[]>([
    {
      id: '1',
      email: 'john.doe@company.com',
      firstName: 'John',
      lastName: 'Doe',
      role: UserRole.LEARNER,
      department: 'Engineering',
      profileImage: '/api/avatars/john-doe.jpg',
      createdAt: new Date('2024-01-15'),
      updatedAt: new Date('2024-01-20'),
      enrollmentsCount: 8,
      completedCourses: 5,
      lastActivity: new Date('2024-01-20'),
      status: 'active'
    },
    {
      id: '2',
      email: 'jane.smith@company.com',
      firstName: 'Jane',
      lastName: 'Smith',
      role: UserRole.INSTRUCTOR,
      department: 'Product',
      createdAt: new Date('2024-01-10'),
      updatedAt: new Date('2024-01-18'),
      enrollmentsCount: 3,
      completedCourses: 12,
      lastActivity: new Date('2024-01-18'),
      status: 'active'
    },
    {
      id: '3',
      email: 'mike.johnson@company.com',
      firstName: 'Mike',
      lastName: 'Johnson',
      role: UserRole.MANAGER,
      department: 'Sales',
      createdAt: new Date('2024-01-05'),
      updatedAt: new Date('2024-01-15'),
      enrollmentsCount: 15,
      completedCourses: 8,
      lastActivity: new Date('2024-01-15'),
      status: 'inactive'
    }
  ]);

  const [selectedUsers, setSelectedUsers] = useState<UserWithStats[]>([]);
  const [userDialog, setUserDialog] = useState<UserDialogData>({
    mode: 'create',
    isOpen: false
  });
  const [filters, setFilters] = useState({
    role: '',
    department: '',
    status: '',
  });
  const [loading, setLoading] = useState(false);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      if (filters.role && user.role !== filters.role) return false;
      if (filters.department && user.department !== filters.department) return false;
      if (filters.status && user.status !== filters.status) return false;
      return true;
    });
  }, [users, filters]);

  const departments = useMemo(() => {
    return Array.from(new Set(users.map(u => u.department).filter(Boolean)));
  }, [users]);

  const bulkActions: BulkAction[] = [
    {
      id: 'export',
      label: 'Export Selected',
      icon: <Download className="h-4 w-4" />,
      action: (users) => handleExportUsers(users),
    },
    {
      id: 'suspend',
      label: 'Suspend Users',
      icon: <Ban className="h-4 w-4" />,
      action: (users) => handleSuspendUsers(users),
      requiresConfirmation: true,
    },
    {
      id: 'activate',
      label: 'Activate Users',
      icon: <CheckCircle className="h-4 w-4" />,
      action: (users) => handleActivateUsers(users),
    },
    {
      id: 'delete',
      label: 'Delete Users',
      icon: <Trash2 className="h-4 w-4" />,
      action: (users) => handleDeleteUsers(users),
      requiresConfirmation: true,
    },
  ];

  const columns = [
    createSelectionColumn(),
    {
      accessorKey: "profileImage",
      header: "Avatar",
      cell: ({ row }: { row: any }) => {
        const user = row.original;
        return (
          <div className="flex items-center justify-center w-8 h-8 bg-gray-200 rounded-full">
            {user.profileImage ? (
              <img
                src={user.profileImage}
                alt={`${user.firstName} ${user.lastName}`}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <span className="text-xs font-medium text-gray-600">
                {user.firstName[0]}{user.lastName[0]}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "firstName",
      header: createSortableHeader("Name"),
      cell: ({ row }: { row: any }) => {
        const user = row.original;
        return (
          <div>
            <p className="font-medium">{user.firstName} {user.lastName}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: createSortableHeader("Role"),
      cell: ({ row }: { row: any }) => {
        const role = row.getValue("role");
        return (
          <Badge className={getRoleColor(role as any)}>
            {role}
          </Badge>
        );
      },
    },
    {
      accessorKey: "department",
      header: createSortableHeader("Department"),
      cell: ({ row }: { row: any }) => row.getValue("department") || "—",
    },
    {
      accessorKey: "status",
      header: createSortableHeader("Status"),
      cell: ({ row }: { row: any }) => {
        const status = row.getValue("status");
        const statusColors = {
          active: "bg-green-100 text-green-800",
          inactive: "bg-gray-100 text-gray-800",
          suspended: "bg-red-100 text-red-800",
        };
        return (
          <Badge className={statusColors[status as keyof typeof statusColors]}>
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: "enrollmentsCount",
      header: createSortableHeader("Enrollments"),
      cell: ({ row }: { row: any }) => {
        const user = row.original;
        return (
          <div className="text-center">
            <p className="font-medium">{user.enrollmentsCount}</p>
            <p className="text-xs text-gray-500">{user.completedCourses} completed</p>
          </div>
        );
      },
    },
    {
      accessorKey: "lastActivity",
      header: createSortableHeader("Last Activity"),
      cell: ({ row }: { row: any }) => {
        const date = row.getValue("lastActivity");
        return (
          <div className="text-sm">
            <p>{formatDate(date as Date)}</p>
          </div>
        );
      },
    },
    createActionColumn((user: UserWithStats) => (
      <>
        <DropdownMenuItem onClick={() => handleViewUser(user)}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleEditUser(user)}>
          <Edit3 className="mr-2 h-4 w-4" />
          Edit User
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSendEmail(user)}>
          <Mail className="mr-2 h-4 w-4" />
          Send Email
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleToggleUserStatus(user)}
          className={user.status === 'suspended' ? 'text-green-600' : 'text-red-600'}
        >
          {user.status === 'suspended' ? (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Activate
            </>
          ) : (
            <>
              <Ban className="mr-2 h-4 w-4" />
              Suspend
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleDeleteUser(user)}
          className="text-red-600"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </>
    )),
  ];

  const handleCreateUser = () => {
    setUserDialog({ mode: 'create', isOpen: true });
  };

  const handleViewUser = (user: UserWithStats) => {
    setUserDialog({ mode: 'view', user, isOpen: true });
  };

  const handleEditUser = (user: UserWithStats) => {
    setUserDialog({ mode: 'edit', user, isOpen: true });
  };

  const handleDeleteUser = (user: UserWithStats) => {
    if (confirm(`Are you sure you want to delete ${user.firstName} ${user.lastName}?`)) {
      setUsers(prev => prev.filter(u => u.id !== user.id));
    }
  };

  const handleToggleUserStatus = (user: UserWithStats) => {
    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';
    setUsers(prev => prev.map(u => 
      u.id === user.id ? { ...u, status: newStatus } : u
    ));
  };

  const handleSendEmail = (user: UserWithStats) => {
    // TODO: Implement email functionality
    console.log('Send email to:', user.email);
  };

  const handleExportUsers = (users: UserWithStats[]) => {
    const csvContent = [
      ['Name', 'Email', 'Role', 'Department', 'Status', 'Enrollments', 'Completed', 'Last Activity'],
      ...users.map(user => [
        `${user.firstName} ${user.lastName}`,
        user.email,
        user.role,
        user.department || '',
        user.status,
        user.enrollmentsCount.toString(),
        user.completedCourses.toString(),
        formatDate(user.lastActivity)
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSuspendUsers = (users: UserWithStats[]) => {
    setUsers(prev => prev.map(u => 
      users.some(su => su.id === u.id) ? { ...u, status: 'suspended' as const } : u
    ));
    setSelectedUsers([]);
  };

  const handleActivateUsers = (users: UserWithStats[]) => {
    setUsers(prev => prev.map(u => 
      users.some(su => su.id === u.id) ? { ...u, status: 'active' as const } : u
    ));
    setSelectedUsers([]);
  };

  const handleDeleteUsers = (users: UserWithStats[]) => {
    if (confirm(`Are you sure you want to delete ${users.length} users?`)) {
      setUsers(prev => prev.filter(u => !users.some(su => su.id === u.id)));
      setSelectedUsers([]);
    }
  };

  const handleBulkAction = (action: BulkAction) => {
    if (selectedUsers.length === 0) return;
    
    if (action.requiresConfirmation) {
      if (confirm(`Are you sure you want to ${action.label.toLowerCase()} ${selectedUsers.length} users?`)) {
        action.action(selectedUsers);
      }
    } else {
      action.action(selectedUsers);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    try {
      // TODO: Implement API call to refresh user data
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Failed to refresh data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">User Management</h2>
          <p className="text-gray-600 mt-1">
            Manage users, roles, and permissions
          </p>
        </div>
        <div className="flex space-x-4">
          <Button variant="outline" onClick={refreshData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Import Users
          </Button>
          <Button onClick={handleCreateUser}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Users</p>
                <p className="text-3xl font-bold text-gray-900">{users.length}</p>
              </div>
              <Users className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Users</p>
                <p className="text-3xl font-bold text-gray-900">
                  {users.filter(u => u.status === 'active').length}
                </p>
              </div>
              <Activity className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Instructors</p>
                <p className="text-3xl font-bold text-gray-900">
                  {users.filter(u => u.role === UserRole.INSTRUCTOR).length}
                </p>
              </div>
              <Shield className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Suspended</p>
                <p className="text-3xl font-bold text-gray-900">
                  {users.filter(u => u.status === 'suspended').length}
                </p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            
            <Select value={filters.role} onValueChange={(value) => setFilters(prev => ({ ...prev, role: value }))}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Roles</SelectItem>
                <SelectItem value={UserRole.LEARNER}>Learner</SelectItem>
                <SelectItem value={UserRole.INSTRUCTOR}>Instructor</SelectItem>
                <SelectItem value={UserRole.MANAGER}>Manager</SelectItem>
                <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.department} onValueChange={(value) => setFilters(prev => ({ ...prev, department: value }))}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Departments</SelectItem>
                {departments.map(dept => (
                  <SelectItem key={dept} value={dept || ''}>{dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.status} onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>

            {(filters.role || filters.department || filters.status) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ role: '', department: '', status: '' })}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedUsers.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                {selectedUsers.length} user{selectedUsers.length > 1 ? 's' : ''} selected
              </p>
              <div className="flex space-x-2">
                {bulkActions.map(action => (
                  <Button
                    key={action.id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkAction(action)}
                  >
                    {action.icon}
                    <span className="ml-2">{action.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users Table */}
      <DataTable
        columns={columns}
        data={filteredUsers}
        onRowSelect={setSelectedUsers}
        searchKey="firstName"
        searchPlaceholder="Search users..."
        loading={loading}
      />

      {/* User Dialog */}
      <Dialog open={userDialog.isOpen} onOpenChange={(open) => setUserDialog(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {userDialog.mode === 'create' && 'Create New User'}
              {userDialog.mode === 'edit' && 'Edit User'}
              {userDialog.mode === 'view' && 'User Details'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {userDialog.mode === 'view' && userDialog.user && (
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center">
                    {userDialog.user.profileImage ? (
                      <img
                        src={userDialog.user.profileImage}
                        alt="Profile"
                        className="w-16 h-16 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-lg font-medium text-gray-600">
                        {userDialog.user.firstName[0]}{userDialog.user.lastName[0]}
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">
                      {userDialog.user.firstName} {userDialog.user.lastName}
                    </h3>
                    <p className="text-gray-600">{userDialog.user.email}</p>
                    <div className="flex items-center space-x-2 mt-2">
                      <Badge className={getRoleColor(userDialog.user.role)}>
                        {userDialog.user.role}
                      </Badge>
                      <Badge className={
                        userDialog.user.status === 'active' ? 'bg-green-100 text-green-800' :
                        userDialog.user.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                        'bg-red-100 text-red-800'
                      }>
                        {userDialog.user.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Department</p>
                    <p className="mt-1">{userDialog.user.department || 'Not specified'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Joined</p>
                    <p className="mt-1">{formatDate(userDialog.user.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Enrollments</p>
                    <p className="mt-1">{userDialog.user.enrollmentsCount}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Completed Courses</p>
                    <p className="mt-1">{userDialog.user.completedCourses}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Last Activity</p>
                    <p className="mt-1">{formatDate(userDialog.user.lastActivity)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Completion Rate</p>
                    <p className="mt-1">
                      {userDialog.user.enrollmentsCount > 0 
                        ? Math.round((userDialog.user.completedCourses / userDialog.user.enrollmentsCount) * 100)
                        : 0
                      }%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {(userDialog.mode === 'create' || userDialog.mode === 'edit') && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">First Name</label>
                    <Input 
                      defaultValue={userDialog.user?.firstName}
                      placeholder="Enter first name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Last Name</label>
                    <Input 
                      defaultValue={userDialog.user?.lastName}
                      placeholder="Enter last name"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Email</label>
                  <Input 
                    type="email"
                    defaultValue={userDialog.user?.email}
                    placeholder="Enter email address"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Role</label>
                    <Select defaultValue={userDialog.user?.role || ''}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UserRole.LEARNER}>Learner</SelectItem>
                        <SelectItem value={UserRole.INSTRUCTOR}>Instructor</SelectItem>
                        <SelectItem value={UserRole.MANAGER}>Manager</SelectItem>
                        <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Department</label>
                    <Input 
                      defaultValue={userDialog.user?.department}
                      placeholder="Enter department"
                    />
                  </div>
                </div>
                
                {userDialog.mode === 'create' && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Password</label>
                    <Input 
                      type="password"
                      placeholder="Enter temporary password"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          
          <DialogFooter>
            {userDialog.mode === 'view' && (
              <>
                <Button variant="outline" onClick={() => setUserDialog(prev => ({ ...prev, isOpen: false }))}>
                  Close
                </Button>
                <Button onClick={() => handleEditUser(userDialog.user!)}>
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit User
                </Button>
              </>
            )}
            
            {(userDialog.mode === 'create' || userDialog.mode === 'edit') && (
              <>
                <Button variant="outline" onClick={() => setUserDialog(prev => ({ ...prev, isOpen: false }))}>
                  Cancel
                </Button>
                <Button>
                  {userDialog.mode === 'create' ? 'Create User' : 'Save Changes'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}