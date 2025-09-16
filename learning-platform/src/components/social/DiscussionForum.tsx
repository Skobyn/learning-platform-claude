'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
  Pin,
  Lock,
  Flag,
  MoreVertical,
  Eye,
  Reply,
  Award,
  Clock,
  User,
  Tag,
  Filter,
  Search,
  Plus,
  TrendingUp,
  Star,
} from 'lucide-react';

interface Discussion {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  authorId: string;
  author: {
    id: string;
    name: string;
    avatar: string;
    role: string;
    reputation?: number;
  };
  replies: Reply[];
  upvotes: number;
  downvotes: number;
  views: number;
  isPinned: boolean;
  isLocked: boolean;
  hasAcceptedAnswer: boolean;
  isQuestion: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Reply {
  id: string;
  content: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    avatar: string;
    role: string;
    reputation?: number;
  };
  discussionId: string;
  parentId?: string;
  upvotes: number;
  downvotes: number;
  isAccepted: boolean;
  isFlagged: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Reply[];
}

interface DiscussionForumProps {
  courseId?: string;
  categoryId?: string;
  initialDiscussions?: Discussion[];
  canModerate?: boolean;
}

export default function DiscussionForum({
  courseId,
  categoryId,
  initialDiscussions = [],
  canModerate = false,
}: DiscussionForumProps) {
  const { data: session } = useSession();
  const [discussions, setDiscussions] = useState<Discussion[]>(initialDiscussions);
  const [selectedDiscussion, setSelectedDiscussion] = useState<Discussion | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'popular' | 'trending' | 'unanswered'>('newest');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [newDiscussion, setNewDiscussion] = useState({
    title: '',
    content: '',
    category: '',
    tags: [] as string[],
    isQuestion: false,
  });
  const [newReply, setNewReply] = useState('');

  // Load discussions
  const loadDiscussions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sortBy,
        ...(filterCategory !== 'all' && { category: filterCategory }),
        ...(searchQuery && { search: searchQuery }),
        ...(courseId && { courseId }),
        ...(categoryId && { categoryId }),
      });

      const response = await fetch(`/api/social/discussions?${params}`);
      if (response.ok) {
        const data = await response.json();
        setDiscussions(data.discussions);
      }
    } catch (error) {
      console.error('Error loading discussions:', error);
    } finally {
      setLoading(false);
    }
  }, [sortBy, filterCategory, searchQuery, courseId, categoryId]);

  useEffect(() => {
    loadDiscussions();
  }, [loadDiscussions]);

  // Create new discussion
  const handleCreateDiscussion = async () => {
    if (!session?.user) return;

    try {
      const response = await fetch('/api/social/discussions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newDiscussion,
          courseId,
          categoryId: categoryId || newDiscussion.category,
        }),
      });

      if (response.ok) {
        const discussion = await response.json();
        setDiscussions([discussion, ...discussions]);
        setNewDiscussion({
          title: '',
          content: '',
          category: '',
          tags: [],
          isQuestion: false,
        });
        setShowCreateForm(false);
      }
    } catch (error) {
      console.error('Error creating discussion:', error);
    }
  };

  // Vote on discussion
  const handleVoteDiscussion = async (discussionId: string, type: 'up' | 'down') => {
    if (!session?.user) return;

    try {
      const response = await fetch(`/api/social/discussions/${discussionId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });

      if (response.ok) {
        await loadDiscussions();
        if (selectedDiscussion?.id === discussionId) {
          // Reload selected discussion
          const discussionResponse = await fetch(`/api/social/discussions/${discussionId}`);
          if (discussionResponse.ok) {
            setSelectedDiscussion(await discussionResponse.json());
          }
        }
      }
    } catch (error) {
      console.error('Error voting on discussion:', error);
    }
  };

  // Reply to discussion
  const handleReply = async (discussionId: string, parentId?: string) => {
    if (!session?.user || !newReply.trim()) return;

    try {
      const response = await fetch(`/api/social/discussions/${discussionId}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newReply,
          parentId,
        }),
      });

      if (response.ok) {
        setNewReply('');
        setReplyingTo(null);

        // Reload the discussion to show new reply
        if (selectedDiscussion?.id === discussionId) {
          const discussionResponse = await fetch(`/api/social/discussions/${discussionId}`);
          if (discussionResponse.ok) {
            setSelectedDiscussion(await discussionResponse.json());
          }
        }
      }
    } catch (error) {
      console.error('Error posting reply:', error);
    }
  };

  // Accept answer
  const handleAcceptAnswer = async (discussionId: string, replyId: string) => {
    if (!session?.user) return;

    try {
      const response = await fetch(`/api/social/discussions/${discussionId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyId }),
      });

      if (response.ok) {
        // Reload the discussion
        const discussionResponse = await fetch(`/api/social/discussions/${discussionId}`);
        if (discussionResponse.ok) {
          setSelectedDiscussion(await discussionResponse.json());
        }
      }
    } catch (error) {
      console.error('Error accepting answer:', error);
    }
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

  const renderReply = (reply: Reply, level = 0) => (
    <div key={reply.id} className={`ml-${level * 4} mt-4 p-4 border-l-2 border-gray-200`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-2 mb-2">
          <img
            src={reply.author.avatar || '/default-avatar.png'}
            alt={reply.author.name}
            className="w-8 h-8 rounded-full"
          />
          <div>
            <span className="font-medium">{reply.author.name}</span>
            <Badge variant="outline" className="ml-2 text-xs">
              {reply.author.role}
            </Badge>
            {reply.author.reputation && (
              <span className="ml-2 text-sm text-gray-500">
                {reply.author.reputation} rep
              </span>
            )}
          </div>
          <span className="text-sm text-gray-500">{formatTimeAgo(reply.createdAt)}</span>
          {reply.isAccepted && (
            <Badge className="bg-green-100 text-green-800">
              <CheckCircle className="w-3 h-3 mr-1" />
              Accepted Answer
            </Badge>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setReplyingTo(reply.id)}>
              <Reply className="w-4 h-4 mr-2" />
              Reply
            </DropdownMenuItem>
            {selectedDiscussion?.isQuestion &&
              selectedDiscussion.author.id === session?.user?.id &&
              !selectedDiscussion.hasAcceptedAnswer && (
                <DropdownMenuItem
                  onClick={() => handleAcceptAnswer(selectedDiscussion.id, reply.id)}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Accept Answer
                </DropdownMenuItem>
              )}
            <DropdownMenuItem>
              <Flag className="w-4 h-4 mr-2" />
              Report
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="prose max-w-none mb-3">
        <p>{reply.content}</p>
      </div>

      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {/* Vote handler */}}
          >
            <ThumbsUp className="w-4 h-4" />
            <span className="ml-1">{reply.upvotes}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {/* Vote handler */}}
          >
            <ThumbsDown className="w-4 h-4" />
            <span className="ml-1">{reply.downvotes}</span>
          </Button>
        </div>
      </div>

      {replyingTo === reply.id && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <textarea
            value={newReply}
            onChange={(e) => setNewReply(e.target.value)}
            placeholder="Write your reply..."
            className="w-full p-3 border rounded-lg resize-none"
            rows={3}
          />
          <div className="flex justify-end space-x-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReplyingTo(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => selectedDiscussion && handleReply(selectedDiscussion.id, reply.id)}
            >
              Post Reply
            </Button>
          </div>
        </div>
      )}

      {reply.children?.map(child => renderReply(child, level + 1))}
    </div>
  );

  if (selectedDiscussion) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setSelectedDiscussion(null)}
          >
            ← Back to Discussions
          </Button>

          <div className="flex items-center space-x-2">
            {selectedDiscussion.isPinned && <Pin className="w-4 h-4 text-blue-500" />}
            {selectedDiscussion.isLocked && <Lock className="w-4 h-4 text-red-500" />}
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle className="text-xl mb-2">
                  {selectedDiscussion.title}
                  {selectedDiscussion.isQuestion && (
                    <Badge className="ml-2 bg-blue-100 text-blue-800">Question</Badge>
                  )}
                </CardTitle>

                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <div className="flex items-center space-x-1">
                    <User className="w-4 h-4" />
                    <span>{selectedDiscussion.author.name}</span>
                    <Badge variant="outline">{selectedDiscussion.author.role}</Badge>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Clock className="w-4 h-4" />
                    <span>{formatTimeAgo(selectedDiscussion.createdAt)}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Eye className="w-4 h-4" />
                    <span>{selectedDiscussion.views} views</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <MessageSquare className="w-4 h-4" />
                    <span>{selectedDiscussion.replies.length} replies</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedDiscussion.tags.map(tag => (
                    <Badge key={tag} variant="secondary">
                      <Tag className="w-3 h-3 mr-1" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <div className="flex flex-col items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleVoteDiscussion(selectedDiscussion.id, 'up')}
                  >
                    <ThumbsUp className="w-4 h-4" />
                  </Button>
                  <span className="font-medium">{selectedDiscussion.upvotes - selectedDiscussion.downvotes}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleVoteDiscussion(selectedDiscussion.id, 'down')}
                  >
                    <ThumbsDown className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="prose max-w-none mb-6">
              <p>{selectedDiscussion.content}</p>
            </div>

            {selectedDiscussion.hasAcceptedAnswer && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center text-green-800 font-medium">
                  <CheckCircle className="w-5 h-5 mr-2" />
                  This question has an accepted answer
                </div>
              </div>
            )}

            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">
                Replies ({selectedDiscussion.replies.length})
              </h3>

              {selectedDiscussion.replies.map(reply => renderReply(reply))}

              {session?.user && !selectedDiscussion.isLocked && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium mb-3">Post a Reply</h4>
                  <textarea
                    value={newReply}
                    onChange={(e) => setNewReply(e.target.value)}
                    placeholder="Write your reply..."
                    className="w-full p-3 border rounded-lg resize-none"
                    rows={4}
                  />
                  <div className="flex justify-end mt-3">
                    <Button
                      onClick={() => handleReply(selectedDiscussion.id)}
                      disabled={!newReply.trim()}
                    >
                      Post Reply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Discussion Forum</h1>
        {session?.user && (
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Discussion
          </Button>
        )}
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search discussions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full border rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 border rounded-lg"
              >
                <option value="newest">Newest</option>
                <option value="popular">Most Popular</option>
                <option value="trending">Trending</option>
                <option value="unanswered">Unanswered</option>
              </select>
            </div>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="all">All Categories</option>
              <option value="general">General</option>
              <option value="technical">Technical</option>
              <option value="study-tips">Study Tips</option>
              <option value="assignments">Assignments</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Create Discussion Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Discussion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Title</label>
              <input
                type="text"
                value={newDiscussion.title}
                onChange={(e) => setNewDiscussion({ ...newDiscussion, title: e.target.value })}
                className="w-full p-3 border rounded-lg"
                placeholder="Enter discussion title..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Content</label>
              <textarea
                value={newDiscussion.content}
                onChange={(e) => setNewDiscussion({ ...newDiscussion, content: e.target.value })}
                className="w-full p-3 border rounded-lg resize-none"
                rows={6}
                placeholder="Write your discussion content..."
              />
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={newDiscussion.category}
                  onChange={(e) => setNewDiscussion({ ...newDiscussion, category: e.target.value })}
                  className="w-full p-3 border rounded-lg"
                >
                  <option value="">Select category...</option>
                  <option value="general">General</option>
                  <option value="technical">Technical</option>
                  <option value="study-tips">Study Tips</option>
                  <option value="assignments">Assignments</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isQuestion"
                  checked={newDiscussion.isQuestion}
                  onChange={(e) => setNewDiscussion({ ...newDiscussion, isQuestion: e.target.checked })}
                />
                <label htmlFor="isQuestion" className="text-sm font-medium">
                  This is a question
                </label>
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateDiscussion}
                disabled={!newDiscussion.title.trim() || !newDiscussion.content.trim()}
              >
                Create Discussion
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Discussions List */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-8">Loading discussions...</div>
        ) : discussions.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">No discussions found</h3>
              <p className="text-gray-500">Be the first to start a discussion!</p>
            </CardContent>
          </Card>
        ) : (
          discussions.map((discussion) => (
            <Card
              key={discussion.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedDiscussion(discussion)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      {discussion.isPinned && <Pin className="w-4 h-4 text-blue-500" />}
                      {discussion.isLocked && <Lock className="w-4 h-4 text-red-500" />}
                      {discussion.isQuestion && (
                        <Badge className="bg-blue-100 text-blue-800">Question</Badge>
                      )}
                      {discussion.hasAcceptedAnswer && (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Answered
                        </Badge>
                      )}
                    </div>

                    <h3 className="text-lg font-semibold mb-2">{discussion.title}</h3>

                    <p className="text-gray-600 mb-3 line-clamp-2">{discussion.content}</p>

                    <div className="flex flex-wrap gap-2 mb-3">
                      {discussion.tags.slice(0, 3).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {discussion.tags.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{discussion.tags.length - 3} more
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <User className="w-4 h-4" />
                        <span>{discussion.author.name}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Clock className="w-4 h-4" />
                        <span>{formatTimeAgo(discussion.createdAt)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <MessageSquare className="w-4 h-4" />
                        <span>{discussion.replies.length}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Eye className="w-4 h-4" />
                        <span>{discussion.views}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <TrendingUp className="w-4 h-4" />
                        <span>{discussion.upvotes - discussion.downvotes}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    <img
                      src={discussion.author.avatar || '/default-avatar.png'}
                      alt={discussion.author.name}
                      className="w-10 h-10 rounded-full"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}