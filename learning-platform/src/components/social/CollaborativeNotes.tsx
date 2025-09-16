'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/Badge';
import {
  Save,
  Share,
  Users,
  Clock,
  MessageSquare,
  Edit3,
  Eye,
  History,
  Download,
  Copy,
  Settings,
  Plus,
  FileText,
  User,
  Cursor,
} from 'lucide-react';

interface Note {
  id: string;
  title: string;
  content: string;
  type: 'PERSONAL' | 'SHARED' | 'GROUP';
  visibility: 'PRIVATE' | 'GROUP' | 'PUBLIC';
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  collaborators: Collaborator[];
  studyGroupId?: string;
  courseId?: string;
  tags: string[];
  version: number;
}

interface Collaborator {
  id: string;
  userId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  joinedAt: string;
  lastActiveAt: string;
  isOnline: boolean;
  cursor?: {
    position: number;
    selection?: { start: number; end: number };
  };
}

interface Comment {
  id: string;
  content: string;
  position: number;
  resolved: boolean;
  author: {
    id: string;
    name: string;
    avatar?: string;
  };
  createdAt: string;
  replies: Comment[];
}

interface CollaborativeNotesProps {
  noteId?: string;
  studyGroupId?: string;
  courseId?: string;
  initialNote?: Note;
  readOnly?: boolean;
}

export default function CollaborativeNotes({
  noteId,
  studyGroupId,
  courseId,
  initialNote,
  readOnly = false,
}: CollaborativeNotesProps) {
  const { data: session } = useSession();
  const [note, setNote] = useState<Note | null>(initialNote || null);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [showComments, setShowComments] = useState(false);
  const [selectedText, setSelectedText] = useState<{ start: number; end: number } | null>(null);
  const [newComment, setNewComment] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [userCursors, setUserCursors] = useState<Map<string, { position: number; name: string; color: string }>>(new Map());

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize WebSocket connection for real-time collaboration
  useEffect(() => {
    if (!noteId || !session?.user) return;

    const token = localStorage.getItem('auth-token'); // Assuming you store JWT token
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'}?token=${token}`;

    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('Connected to collaborative editing');

      // Join the note room
      wsRef.current?.send(JSON.stringify({
        type: 'room:join',
        data: { room: `note:${noteId}` }
      }));
    };

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    wsRef.current.onclose = () => {
      console.log('Disconnected from collaborative editing');
    };

    return () => {
      wsRef.current?.close();
    };
  }, [noteId, session?.user]);

  // Load note data
  useEffect(() => {
    if (noteId && !initialNote) {
      loadNote();
    } else if (initialNote) {
      setNote(initialNote);
      setContent(initialNote.content);
      setTitle(initialNote.title);
      setCollaborators(initialNote.collaborators);
    }
  }, [noteId, initialNote]);

  // Auto-save functionality
  useEffect(() => {
    if (!note || !isEditing || readOnly) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 2000); // Auto-save after 2 seconds of inactivity

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [content, title, isEditing]);

  const loadNote = async () => {
    try {
      const response = await fetch(`/api/social/notes/${noteId}`);
      if (response.ok) {
        const noteData = await response.json();
        setNote(noteData);
        setContent(noteData.content);
        setTitle(noteData.title);
        setCollaborators(noteData.collaborators);
      }
    } catch (error) {
      console.error('Error loading note:', error);
    }
  };

  const handleWebSocketMessage = (message: any) => {
    switch (message.type) {
      case 'note:content_changed':
        if (message.data.userId !== session?.user?.id) {
          setContent(message.data.content);
        }
        break;

      case 'note:title_changed':
        if (message.data.userId !== session?.user?.id) {
          setTitle(message.data.title);
        }
        break;

      case 'note:cursor_moved':
        if (message.data.userId !== session?.user?.id) {
          setUserCursors(prev => {
            const newCursors = new Map(prev);
            newCursors.set(message.data.userId, {
              position: message.data.position,
              name: message.data.userName,
              color: message.data.color || generateUserColor(message.data.userId),
            });
            return newCursors;
          });
        }
        break;

      case 'note:collaborator_joined':
        setCollaborators(prev => [...prev, message.data.collaborator]);
        break;

      case 'note:collaborator_left':
        setCollaborators(prev => prev.filter(c => c.userId !== message.data.userId));
        setUserCursors(prev => {
          const newCursors = new Map(prev);
          newCursors.delete(message.data.userId);
          return newCursors;
        });
        break;

      case 'note:comment_added':
        setComments(prev => [...prev, message.data.comment]);
        break;

      case 'note:saved':
        setLastSaved(new Date(message.data.timestamp));
        setIsSaving(false);
        break;
    }
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);

    if (!readOnly && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'note:content_change',
        data: {
          noteId,
          content: newContent,
          userId: session?.user?.id,
        }
      }));
    }
  };

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);

    if (!readOnly && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'note:title_change',
        data: {
          noteId,
          title: newTitle,
          userId: session?.user?.id,
        }
      }));
    }
  };

  const handleCursorMove = useCallback(() => {
    if (!editorRef.current || readOnly || !wsRef.current) return;

    const position = editorRef.current.selectionStart;

    wsRef.current.send(JSON.stringify({
      type: 'note:cursor_move',
      data: {
        noteId,
        position,
        userId: session?.user?.id,
        userName: session?.user?.name,
      }
    }));
  }, [noteId, session?.user, readOnly]);

  const handleSave = async () => {
    if (!note || readOnly) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/social/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
        }),
      });

      if (response.ok) {
        setLastSaved(new Date());

        // Broadcast save to other collaborators
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'note:save',
            data: { noteId, timestamp: new Date().toISOString() }
          }));
        }
      }
    } catch (error) {
      console.error('Error saving note:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !selectedText) return;

    try {
      const response = await fetch(`/api/social/notes/${noteId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment,
          position: selectedText.start,
          selection: selectedText,
        }),
      });

      if (response.ok) {
        const comment = await response.json();
        setComments(prev => [...prev, comment]);
        setNewComment('');
        setSelectedText(null);

        // Broadcast comment to other collaborators
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'note:comment_add',
            data: { noteId, comment }
          }));
        }
      }
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const handleShare = async () => {
    if (!note) return;

    try {
      const shareUrl = `${window.location.origin}/notes/${note.id}`;
      await navigator.clipboard.writeText(shareUrl);
      // You could show a toast notification here
    } catch (error) {
      console.error('Error sharing note:', error);
    }
  };

  const generateUserColor = (userId: string): string => {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];
    const hash = userId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return colors[Math.abs(hash) % colors.length];
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const canEdit = !readOnly && (
    note?.type === 'PERSONAL' ||
    collaborators.find(c => c.userId === session?.user?.id)?.role !== 'VIEWER'
  );

  if (!note && !initialNote) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-lg">Loading note...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              {canEdit ? (
                <input
                  type="text"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="text-2xl font-bold bg-transparent border-none outline-none w-full"
                  placeholder="Untitled Note"
                />
              ) : (
                <CardTitle className="text-2xl">{title || 'Untitled Note'}</CardTitle>
              )}

              <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                <div className="flex items-center space-x-1">
                  <Clock className="w-4 h-4" />
                  <span>
                    {lastSaved ? `Saved ${formatTimeAgo(lastSaved.toISOString())}` :
                     note?.updatedAt ? `Last updated ${formatTimeAgo(note.updatedAt)}` :
                     'Not saved'}
                  </span>
                </div>

                {isSaving && (
                  <div className="flex items-center space-x-1 text-blue-600">
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                    <span>Saving...</span>
                  </div>
                )}

                <div className="flex items-center space-x-1">
                  <Users className="w-4 h-4" />
                  <span>{collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Online Collaborators */}
              <div className="flex items-center space-x-1">
                {collaborators
                  .filter(c => c.isOnline && c.userId !== session?.user?.id)
                  .slice(0, 3)
                  .map(collaborator => (
                    <img
                      key={collaborator.userId}
                      src={collaborator.user.avatar || '/default-avatar.png'}
                      alt={collaborator.user.name}
                      className="w-8 h-8 rounded-full border-2 border-white shadow-sm"
                      title={`${collaborator.user.name} (${collaborator.role.toLowerCase()})`}
                    />
                  ))}
                {collaborators.filter(c => c.isOnline).length > 3 && (
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs">
                    +{collaborators.filter(c => c.isOnline).length - 3}
                  </div>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowComments(!showComments)}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Comments ({comments.length})
              </Button>

              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share className="w-4 h-4 mr-2" />
                Share
              </Button>

              {canEdit && (
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Editor */}
        <div className="lg:col-span-3">
          <Card className="h-[600px]">
            <CardContent className="p-0 h-full">
              <div className="relative h-full">
                <textarea
                  ref={editorRef}
                  value={content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  onSelect={handleCursorMove}
                  onKeyUp={handleCursorMove}
                  onClick={handleCursorMove}
                  className="w-full h-full p-6 border-none outline-none resize-none"
                  placeholder={canEdit ? "Start writing your note..." : "This note is read-only"}
                  disabled={!canEdit}
                />

                {/* User Cursors */}
                {Array.from(userCursors.entries()).map(([userId, cursor]) => (
                  <div
                    key={userId}
                    className="absolute pointer-events-none"
                    style={{
                      // This would require more complex positioning logic in a real implementation
                      top: Math.floor(cursor.position / 50) * 20 + 24, // Simplified calculation
                      left: (cursor.position % 50) * 8 + 24,
                    }}
                  >
                    <div className="flex items-center">
                      <Cursor
                        className="w-4 h-4"
                        style={{ color: cursor.color }}
                      />
                      <div
                        className="ml-1 px-2 py-1 rounded text-xs text-white"
                        style={{ backgroundColor: cursor.color }}
                      >
                        {cursor.name}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Collaborators */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Collaborators</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {collaborators.map(collaborator => (
                <div key={collaborator.userId} className="flex items-center space-x-3">
                  <div className="relative">
                    <img
                      src={collaborator.user.avatar || '/default-avatar.png'}
                      alt={collaborator.user.name}
                      className="w-10 h-10 rounded-full"
                    />
                    {collaborator.isOnline && (
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium">{collaborator.user.name}</h4>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="text-xs">
                        {collaborator.role}
                      </Badge>
                      {collaborator.isOnline ? (
                        <span className="text-xs text-green-600">Online</span>
                      ) : (
                        <span className="text-xs text-gray-500">
                          {formatTimeAgo(collaborator.lastActiveAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Comments */}
          {showComments && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Comments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedText && canEdit && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <h5 className="font-medium mb-2">Add Comment</h5>
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      className="w-full p-2 border rounded resize-none"
                      rows={3}
                      placeholder="Write a comment..."
                    />
                    <div className="flex justify-end space-x-2 mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedText(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleAddComment}
                        disabled={!newComment.trim()}
                      >
                        Add Comment
                      </Button>
                    </div>
                  </div>
                )}

                {comments.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p>No comments yet</p>
                    <p className="text-sm">Select text to add a comment</p>
                  </div>
                ) : (
                  comments.map(comment => (
                    <div key={comment.id} className="p-3 border rounded-lg">
                      <div className="flex items-start space-x-2">
                        <img
                          src={comment.author.avatar || '/default-avatar.png'}
                          alt={comment.author.name}
                          className="w-6 h-6 rounded-full"
                        />
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="text-sm font-medium">{comment.author.name}</span>
                            <span className="text-xs text-gray-500">
                              {formatTimeAgo(comment.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm">{comment.content}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}