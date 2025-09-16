'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users,
  Calendar,
  BookOpen,
  Share,
  MessageSquare,
  Video,
  MapPin,
  Clock,
  Star,
  Settings,
  UserPlus,
  FileText,
  Link as LinkIcon,
  Upload,
  Play,
  MoreVertical,
  Shield,
  Crown,
} from 'lucide-react';

interface StudyGroup {
  id: string;
  name: string;
  description: string;
  type: 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY';
  maxMembers: number;
  tags: string[];
  isVirtual: boolean;
  location?: string;
  createdAt: string;
  members: Member[];
  sessions: Session[];
  resources: Resource[];
  relatedCourses: Course[];
  userRole?: 'ADMIN' | 'MODERATOR' | 'MEMBER';
  canJoin?: boolean;
  _count: {
    members: number;
    sessions: number;
    resources: number;
  };
}

interface Member {
  id: string;
  role: 'ADMIN' | 'MODERATOR' | 'MEMBER';
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    profileImageUrl?: string;
    reputation: number;
  };
}

interface Session {
  id: string;
  title: string;
  description: string;
  scheduledFor: string;
  duration: number;
  type: 'STUDY' | 'DISCUSSION' | 'PROJECT' | 'REVIEW';
  isVirtual: boolean;
  location?: string;
  meetingUrl?: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  attendees: any[];
  _count: {
    attendees: number;
  };
}

interface Resource {
  id: string;
  title: string;
  description?: string;
  type: 'FILE' | 'LINK' | 'NOTE' | 'VIDEO';
  url: string;
  fileSize?: number;
  tags: string[];
  createdAt: string;
  uploadedBy: {
    id: string;
    name: string;
    profileImageUrl?: string;
  };
}

interface Course {
  id: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  level: string;
}

interface StudyGroupProps {
  groupId?: string;
  initialGroup?: StudyGroup;
  canManage?: boolean;
}

export default function StudyGroup({ groupId, initialGroup, canManage = false }: StudyGroupProps) {
  const { data: session } = useSession();
  const [group, setGroup] = useState<StudyGroup | null>(initialGroup || null);
  const [loading, setLoading] = useState(!initialGroup);
  const [activeTab, setActiveTab] = useState('overview');
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showResourceUpload, setShowResourceUpload] = useState(false);
  const [newSession, setNewSession] = useState({
    title: '',
    description: '',
    scheduledFor: '',
    duration: 60,
    type: 'STUDY' as const,
    isVirtual: true,
    location: '',
    meetingUrl: '',
  });
  const [newResource, setNewResource] = useState({
    title: '',
    description: '',
    type: 'LINK' as const,
    url: '',
    tags: [] as string[],
  });

  useEffect(() => {
    if (groupId && !initialGroup) {
      loadGroup();
    }
  }, [groupId, initialGroup]);

  const loadGroup = async () => {
    if (!groupId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/social/groups/${groupId}`);
      if (response.ok) {
        const data = await response.json();
        setGroup(data);
      }
    } catch (error) {
      console.error('Error loading study group:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!group || !session?.user) return;

    try {
      const response = await fetch(`/api/social/groups/${group.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        await loadGroup();
      }
    } catch (error) {
      console.error('Error joining group:', error);
    }
  };

  const handleCreateSession = async () => {
    if (!group || !session?.user) return;

    try {
      const response = await fetch(`/api/social/groups/${group.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSession),
      });

      if (response.ok) {
        setNewSession({
          title: '',
          description: '',
          scheduledFor: '',
          duration: 60,
          type: 'STUDY',
          isVirtual: true,
          location: '',
          meetingUrl: '',
        });
        setShowCreateSession(false);
        await loadGroup();
      }
    } catch (error) {
      console.error('Error creating session:', error);
    }
  };

  const handleUploadResource = async () => {
    if (!group || !session?.user) return;

    try {
      const response = await fetch(`/api/social/groups/${group.id}/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newResource),
      });

      if (response.ok) {
        setNewResource({
          title: '',
          description: '',
          type: 'LINK',
          url: '',
          tags: [],
        });
        setShowResourceUpload(false);
        await loadGroup();
      }
    } catch (error) {
      console.error('Error uploading resource:', error);
    }
  };

  const handleRegisterForSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/social/groups/sessions/${sessionId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        await loadGroup();
      }
    } catch (error) {
      console.error('Error registering for session:', error);
    }
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return <Crown className="w-4 h-4 text-yellow-500" />;
      case 'MODERATOR':
        return <Shield className="w-4 h-4 text-blue-500" />;
      default:
        return null;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'FILE':
        return <FileText className="w-4 h-4" />;
      case 'LINK':
        return <LinkIcon className="w-4 h-4" />;
      case 'VIDEO':
        return <Play className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-lg">Loading study group...</div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="text-center py-12">
        <div className="text-lg font-medium text-gray-600 mb-2">Study group not found</div>
        <p className="text-gray-500">The study group you're looking for doesn't exist or has been removed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <CardTitle className="text-2xl">{group.name}</CardTitle>
                <Badge variant={group.type === 'PUBLIC' ? 'default' : 'secondary'}>
                  {group.type}
                </Badge>
                {group.isVirtual && <Badge variant="outline">Virtual</Badge>}
              </div>

              <p className="text-gray-600 mb-4">{group.description}</p>

              <div className="flex flex-wrap gap-2 mb-4">
                {group.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>

              <div className="flex items-center space-x-6 text-sm text-gray-500">
                <div className="flex items-center space-x-1">
                  <Users className="w-4 h-4" />
                  <span>{group._count.members} / {group.maxMembers} members</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Calendar className="w-4 h-4" />
                  <span>{group._count.sessions} sessions</span>
                </div>
                <div className="flex items-center space-x-1">
                  <BookOpen className="w-4 h-4" />
                  <span>{group._count.resources} resources</span>
                </div>
                {!group.isVirtual && group.location && (
                  <div className="flex items-center space-x-1">
                    <MapPin className="w-4 h-4" />
                    <span>{group.location}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {group.canJoin && session?.user && (
                <Button onClick={handleJoinGroup}>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Join Group
                </Button>
              )}
              {group.userRole && canManage && (
                <Button variant="outline">
                  <Settings className="w-4 h-4 mr-2" />
                  Manage
                </Button>
              )}
              {group.userRole && (
                <Button variant="outline" onClick={() => setShowInviteDialog(true)}>
                  <Share className="w-4 h-4 mr-2" />
                  Invite
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Related Courses */}
          {group.relatedCourses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Related Courses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.relatedCourses.map(course => (
                    <div key={course.id} className="flex items-center space-x-3 p-3 border rounded-lg">
                      {course.thumbnailUrl && (
                        <img
                          src={course.thumbnailUrl}
                          alt={course.title}
                          className="w-12 h-12 rounded object-cover"
                        />
                      )}
                      <div className="flex-1">
                        <h4 className="font-medium">{course.title}</h4>
                        <p className="text-sm text-gray-500">{course.level}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upcoming Sessions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Upcoming Sessions</CardTitle>
                {group.userRole && ['ADMIN', 'MODERATOR'].includes(group.userRole) && (
                  <Button size="sm" onClick={() => setShowCreateSession(true)}>
                    <Calendar className="w-4 h-4 mr-2" />
                    Schedule Session
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {group.sessions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No upcoming sessions scheduled
                </div>
              ) : (
                <div className="space-y-4">
                  {group.sessions.slice(0, 3).map(session => (
                    <div key={session.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <h4 className="font-medium">{session.title}</h4>
                        <p className="text-sm text-gray-600 mb-2">{session.description}</p>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <div className="flex items-center space-x-1">
                            <Clock className="w-4 h-4" />
                            <span>{formatDateTime(session.scheduledFor)}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <Users className="w-4 h-4" />
                            <span>{session._count.attendees} registered</span>
                          </div>
                          {session.isVirtual && (
                            <Badge variant="outline" className="text-xs">Virtual</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="secondary">{session.type}</Badge>
                        {group.userRole && (
                          <Button size="sm" onClick={() => handleRegisterForSession(session.id)}>
                            Register
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Resources */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Resources</CardTitle>
                {group.userRole && (
                  <Button size="sm" onClick={() => setShowResourceUpload(true)}>
                    <Upload className="w-4 h-4 mr-2" />
                    Share Resource
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {group.resources.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No resources shared yet
                </div>
              ) : (
                <div className="space-y-3">
                  {group.resources.slice(0, 3).map(resource => (
                    <div key={resource.id} className="flex items-center space-x-3 p-3 border rounded-lg">
                      {getTypeIcon(resource.type)}
                      <div className="flex-1">
                        <h4 className="font-medium">{resource.title}</h4>
                        {resource.description && (
                          <p className="text-sm text-gray-600">{resource.description}</p>
                        )}
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-xs text-gray-500">
                            by {resource.uploadedBy.name}
                          </span>
                          {resource.tags.map(tag => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <a href={resource.url} target="_blank" rel="noopener noreferrer">
                          View
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Study Sessions</h3>
            {group.userRole && ['ADMIN', 'MODERATOR'].includes(group.userRole) && (
              <Button onClick={() => setShowCreateSession(true)}>
                <Calendar className="w-4 h-4 mr-2" />
                Schedule Session
              </Button>
            )}
          </div>

          <div className="space-y-4">
            {group.sessions.map(session => (
              <Card key={session.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">{session.title}</h4>
                      <p className="text-gray-600 mb-3">{session.description}</p>

                      <div className="flex items-center space-x-4 text-sm text-gray-500 mb-3">
                        <div className="flex items-center space-x-1">
                          <Clock className="w-4 h-4" />
                          <span>{formatDateTime(session.scheduledFor)}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Users className="w-4 h-4" />
                          <span>{session._count.attendees} registered</span>
                        </div>
                        <Badge variant="secondary">{session.type}</Badge>
                        {session.isVirtual ? (
                          <Badge variant="outline">Virtual</Badge>
                        ) : (
                          <div className="flex items-center space-x-1">
                            <MapPin className="w-4 h-4" />
                            <span>{session.location}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Badge
                        variant={
                          session.status === 'SCHEDULED' ? 'default' :
                          session.status === 'IN_PROGRESS' ? 'default' :
                          session.status === 'COMPLETED' ? 'secondary' : 'outline'
                        }
                      >
                        {session.status}
                      </Badge>
                      {group.userRole && session.status === 'SCHEDULED' && (
                        <Button size="sm" onClick={() => handleRegisterForSession(session.id)}>
                          Register
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Shared Resources</h3>
            {group.userRole && (
              <Button onClick={() => setShowResourceUpload(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Share Resource
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.resources.map(resource => (
              <Card key={resource.id}>
                <CardContent className="p-4">
                  <div className="flex items-start space-x-3">
                    {getTypeIcon(resource.type)}
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">{resource.title}</h4>
                      {resource.description && (
                        <p className="text-sm text-gray-600 mb-2">{resource.description}</p>
                      )}

                      <div className="flex flex-wrap gap-1 mb-3">
                        {resource.tags.map(tag => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-sm text-gray-500">
                          <img
                            src={resource.uploadedBy.profileImageUrl || '/default-avatar.png'}
                            alt={resource.uploadedBy.name}
                            className="w-5 h-5 rounded-full"
                          />
                          <span>{resource.uploadedBy.name}</span>
                        </div>
                        <Button size="sm" variant="outline" asChild>
                          <a href={resource.url} target="_blank" rel="noopener noreferrer">
                            View
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Members ({group._count.members})</h3>
            {group.userRole && ['ADMIN', 'MODERATOR'].includes(group.userRole) && (
              <Button onClick={() => setShowInviteDialog(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Members
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.members.map(member => (
              <Card key={member.id}>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-3">
                    <img
                      src={member.user.profileImageUrl || '/default-avatar.png'}
                      alt={member.user.name}
                      className="w-12 h-12 rounded-full"
                    />
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-medium">{member.user.name}</h4>
                        {getRoleIcon(member.role)}
                      </div>
                      <p className="text-sm text-gray-600">{member.role}</p>
                      <div className="flex items-center space-x-2 mt-1">
                        <Star className="w-3 h-3 text-yellow-500" />
                        <span className="text-xs text-gray-500">{member.user.reputation} rep</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Session Modal */}
      {showCreateSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Schedule Study Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={newSession.title}
                  onChange={(e) => setNewSession({ ...newSession, title: e.target.value })}
                  className="w-full p-2 border rounded-lg"
                  placeholder="Session title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={newSession.description}
                  onChange={(e) => setNewSession({ ...newSession, description: e.target.value })}
                  className="w-full p-2 border rounded-lg resize-none"
                  rows={3}
                  placeholder="Session description..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Date & Time</label>
                  <input
                    type="datetime-local"
                    value={newSession.scheduledFor}
                    onChange={(e) => setNewSession({ ...newSession, scheduledFor: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Duration (minutes)</label>
                  <input
                    type="number"
                    value={newSession.duration}
                    onChange={(e) => setNewSession({ ...newSession, duration: parseInt(e.target.value) })}
                    className="w-full p-2 border rounded-lg"
                    min="15"
                    step="15"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Type</label>
                <select
                  value={newSession.type}
                  onChange={(e) => setNewSession({ ...newSession, type: e.target.value as any })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="STUDY">Study Session</option>
                  <option value="DISCUSSION">Discussion</option>
                  <option value="PROJECT">Project Work</option>
                  <option value="REVIEW">Review Session</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isVirtual"
                  checked={newSession.isVirtual}
                  onChange={(e) => setNewSession({ ...newSession, isVirtual: e.target.checked })}
                />
                <label htmlFor="isVirtual" className="text-sm font-medium">
                  Virtual session
                </label>
              </div>

              {newSession.isVirtual ? (
                <div>
                  <label className="block text-sm font-medium mb-2">Meeting URL</label>
                  <input
                    type="url"
                    value={newSession.meetingUrl}
                    onChange={(e) => setNewSession({ ...newSession, meetingUrl: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                    placeholder="https://zoom.us/j/..."
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-2">Location</label>
                  <input
                    type="text"
                    value={newSession.location}
                    onChange={(e) => setNewSession({ ...newSession, location: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                    placeholder="Room, building, or address..."
                  />
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowCreateSession(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateSession}
                  disabled={!newSession.title.trim() || !newSession.scheduledFor}
                >
                  Schedule Session
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Upload Resource Modal */}
      {showResourceUpload && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Share Resource</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={newResource.title}
                  onChange={(e) => setNewResource({ ...newResource, title: e.target.value })}
                  className="w-full p-2 border rounded-lg"
                  placeholder="Resource title..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={newResource.description}
                  onChange={(e) => setNewResource({ ...newResource, description: e.target.value })}
                  className="w-full p-2 border rounded-lg resize-none"
                  rows={3}
                  placeholder="Brief description..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Type</label>
                <select
                  value={newResource.type}
                  onChange={(e) => setNewResource({ ...newResource, type: e.target.value as any })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="LINK">Link</option>
                  <option value="FILE">File</option>
                  <option value="VIDEO">Video</option>
                  <option value="NOTE">Note</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">URL</label>
                <input
                  type="url"
                  value={newResource.url}
                  onChange={(e) => setNewResource({ ...newResource, url: e.target.value })}
                  className="w-full p-2 border rounded-lg"
                  placeholder="https://..."
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowResourceUpload(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleUploadResource}
                  disabled={!newResource.title.trim() || !newResource.url.trim()}
                >
                  Share Resource
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}