'use client';

import React, { useState, useEffect } from 'react';
import { Play, Clock, Users, Target, CheckCircle, Lock, Star, Share2, BookOpen, Award, TrendingUp, ChevronRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'react-hot-toast';

interface PathItem {
  id: string;
  itemType: 'COURSE' | 'MODULE' | 'LEARNING_PATH' | 'ASSESSMENT' | 'RESOURCE';
  itemId: string;
  title: string;
  description?: string;
  orderIndex: number;
  section?: string;
  isRequired: boolean;
  prerequisites: string[];
  estimatedDuration: number;
  unlockDelay: number;
  progress?: {
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
    progressPercentage: number;
    score?: number;
    timeSpent: number;
    completedAt?: Date;
  };
}

interface PathDependency {
  id: string;
  prerequisitePathId: string;
  prerequisitePathTitle: string;
  dependencyType: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  minimumCompletionPercentage: number;
}

interface LearningPath {
  id: string;
  title: string;
  description: string;
  shortDescription?: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimatedDuration: number;
  tags: string[];
  skills: string[];
  prerequisites: string[];
  learningObjectives: string[];
  isPublic: boolean;
  isFeatured: boolean;
  status: string;
  enrollmentCount: number;
  completionCount: number;
  averageRating: number;
  createdAt: Date;
  items: PathItem[];
  dependencies?: PathDependency[];
  userEnrollment?: {
    id: string;
    status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'DROPPED';
    progressPercentage: number;
    enrolledAt: Date;
    completedAt?: Date;
    timeSpent: number;
  };
}

interface PathViewerProps {
  path: LearningPath;
  canEnroll?: boolean;
  canEdit?: boolean;
  onEnroll?: () => Promise<void>;
  onContinue?: (itemId: string) => void;
  onShare?: () => void;
  onEdit?: () => void;
}

const DIFFICULTY_COLORS = {
  BEGINNER: 'bg-green-100 text-green-800 border-green-200',
  INTERMEDIATE: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  ADVANCED: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_COLORS = {
  NOT_STARTED: 'text-gray-500',
  IN_PROGRESS: 'text-blue-600',
  COMPLETED: 'text-green-600',
  SKIPPED: 'text-orange-600',
};

const ITEM_TYPE_ICONS = {
  COURSE: BookOpen,
  MODULE: Target,
  LEARNING_PATH: Users,
  ASSESSMENT: Award,
  RESOURCE: Play,
};

export default function PathViewer({
  path,
  canEnroll = true,
  canEdit = false,
  onEnroll,
  onContinue,
  onShare,
  onEdit,
}: PathViewerProps) {
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [showPrerequisites, setShowPrerequisites] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const isEnrolled = !!path.userEnrollment;
  const completionRate = path.enrollmentCount > 0 ? (path.completionCount / path.enrollmentCount) * 100 : 0;
  const estimatedHours = Math.round(path.estimatedDuration / 60);
  const estimatedWeeks = Math.ceil(estimatedHours / 10); // Assuming 10 hours per week

  // Group items by section
  const itemsBySection = path.items.reduce((acc, item) => {
    const section = item.section || 'Main Content';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, PathItem[]>);

  // Calculate next item to work on
  const nextItem = path.items.find(item =>
    item.progress?.status === 'NOT_STARTED' ||
    item.progress?.status === 'IN_PROGRESS'
  );

  // Check if prerequisites are met
  const prerequisitesMet = path.dependencies?.every(dep => {
    if (dep.dependencyType === 'REQUIRED') {
      // This would need to check actual user progress on prerequisite paths
      return true; // Simplified for now
    }
    return true;
  }) ?? true;

  const handleEnroll = async () => {
    if (!onEnroll) return;

    setIsEnrolling(true);
    try {
      await onEnroll();
      toast.success('Successfully enrolled in learning path!');
    } catch (error) {
      toast.error('Failed to enroll. Please try again.');
    } finally {
      setIsEnrolling(false);
    }
  };

  const getItemStatus = (item: PathItem) => {
    if (!item.progress) return 'NOT_STARTED';
    return item.progress.status;
  };

  const isItemUnlocked = (item: PathItem) => {
    if (!isEnrolled) return false;

    // Check if prerequisites are completed
    const prerequisiteItems = path.items.filter(i =>
      item.prerequisites.includes(i.id)
    );

    return prerequisiteItems.every(prereq =>
      prereq.progress?.status === 'COMPLETED'
    );
  };

  const renderItemStatus = (item: PathItem) => {
    const status = getItemStatus(item);
    const unlocked = isItemUnlocked(item);

    if (!isEnrolled) {
      return <Lock className="h-4 w-4 text-gray-400" />;
    }

    if (!unlocked) {
      return <Lock className="h-4 w-4 text-gray-400" />;
    }

    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'IN_PROGRESS':
        return <Play className="h-4 w-4 text-blue-600" />;
      case 'SKIPPED':
        return <ChevronRight className="h-4 w-4 text-orange-600" />;
      default:
        return <Play className="h-4 w-4 text-gray-400" />;
    }
  };

  const renderCTASection = () => {
    if (!isEnrolled && canEnroll) {
      return (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Ready to start learning?
              </h3>
              <p className="text-gray-600">
                Join {path.enrollmentCount.toLocaleString()} other learners on this path
              </p>
            </div>
            <div className="flex items-center gap-3">
              {!prerequisitesMet && (
                <Button
                  variant="outline"
                  onClick={() => setShowPrerequisites(true)}
                  className="text-orange-600 border-orange-200"
                >
                  <AlertCircle className="h-4 w-4 mr-2" />
                  Prerequisites
                </Button>
              )}
              <Button
                onClick={handleEnroll}
                disabled={isEnrolling || !prerequisitesMet}
                size="lg"
              >
                {isEnrolling ? 'Enrolling...' : 'Enroll Now'}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (isEnrolled) {
      const enrollment = path.userEnrollment!;
      return (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {enrollment.status === 'COMPLETED' ? 'Congratulations!' : 'Continue Learning'}
              </h3>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span>{Math.round(enrollment.progressPercentage)}% complete</span>
                <span>{Math.round(enrollment.timeSpent / 60)} hours spent</span>
                {enrollment.status === 'COMPLETED' && enrollment.completedAt && (
                  <span>Completed {enrollment.completedAt.toLocaleDateString()}</span>
                )}
              </div>
              <Progress value={enrollment.progressPercentage} className="w-64 mt-2" />
            </div>
            <div className="flex items-center gap-3">
              {enrollment.status !== 'COMPLETED' && nextItem && onContinue && (
                <Button
                  onClick={() => onContinue(nextItem.id)}
                  size="lg"
                >
                  Continue: {nextItem.title}
                </Button>
              )}
              {enrollment.status === 'COMPLETED' && (
                <Button variant="outline" size="lg">
                  <Award className="h-4 w-4 mr-2" />
                  View Certificate
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="relative">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <Badge className={DIFFICULTY_COLORS[path.difficulty]}>
                {path.difficulty}
              </Badge>
              <Badge variant="outline">{path.category}</Badge>
              {path.isFeatured && (
                <Badge className="bg-purple-100 text-purple-800">
                  <Star className="h-3 w-3 mr-1" />
                  Featured
                </Badge>
              )}
            </div>

            <h1 className="text-4xl font-bold text-gray-900 mb-3">
              {path.title}
            </h1>

            <p className="text-lg text-gray-600 mb-4 max-w-3xl">
              {path.description}
            </p>

            <div className="flex items-center gap-6 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {estimatedHours} hours • {estimatedWeeks} weeks
              </div>
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {path.enrollmentCount.toLocaleString()} enrolled
              </div>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-4 w-4" />
                {Math.round(completionRate)}% completion rate
              </div>
              {path.averageRating > 0 && (
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-current text-yellow-500" />
                  {path.averageRating.toFixed(1)}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {onShare && (
              <Button variant="outline" onClick={onShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            )}
            {canEdit && onEdit && (
              <Button variant="outline" onClick={onEdit}>
                Edit Path
              </Button>
            )}
          </div>
        </div>

        {/* CTA Section */}
        {renderCTASection()}
      </div>

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="curriculum">Curriculum ({path.items.length})</TabsTrigger>
          <TabsTrigger value="skills">Skills & Outcomes</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              {/* What you'll learn */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    What you'll learn
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {path.learningObjectives.map((objective, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                        <span className="text-gray-700">{objective}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Prerequisites */}
              {(path.prerequisites.length > 0 || path.dependencies?.length) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Prerequisites</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {path.prerequisites.map((prereq, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                          <span className="text-gray-700">{prereq}</span>
                        </div>
                      ))}
                      {path.dependencies?.map((dep) => (
                        <div key={dep.id} className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                          <span className="text-gray-700">
                            {dep.prerequisitePathTitle}
                            {dep.dependencyType === 'REQUIRED' && ' (Required)'}
                            {dep.minimumCompletionPercentage < 100 &&
                              ` - ${dep.minimumCompletionPercentage}% completion needed`
                            }
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Path Stats */}
              <Card>
                <CardHeader>
                  <CardTitle>Path Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Total Items</span>
                    <span className="font-semibold">{path.items.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Required Items</span>
                    <span className="font-semibold">
                      {path.items.filter(item => item.isRequired).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Estimated Time</span>
                    <span className="font-semibold">{estimatedHours}h</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Learners</span>
                    <span className="font-semibold">{path.enrollmentCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Completion Rate</span>
                    <span className="font-semibold">{Math.round(completionRate)}%</span>
                  </div>
                </CardContent>
              </Card>

              {/* Tags */}
              {path.tags.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Tags</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {path.tags.map(tag => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Curriculum Tab */}
        <TabsContent value="curriculum" className="space-y-6">
          {Object.entries(itemsBySection).map(([section, items]) => (
            <Card key={section}>
              <CardHeader>
                <CardTitle>{section}</CardTitle>
                <p className="text-sm text-gray-600">
                  {items.length} items • {Math.round(items.reduce((sum, item) => sum + item.estimatedDuration, 0) / 60)} hours
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {items.map((item, index) => {
                    const ItemIcon = ITEM_TYPE_ICONS[item.itemType];
                    const status = getItemStatus(item);
                    const unlocked = isItemUnlocked(item);

                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-4 p-3 rounded-lg border ${
                          unlocked && isEnrolled ? 'hover:bg-gray-50 cursor-pointer' : ''
                        } ${!unlocked && isEnrolled ? 'opacity-60' : ''}`}
                        onClick={() => {
                          if (unlocked && isEnrolled && onContinue) {
                            onContinue(item.id);
                          }
                        }}
                      >
                        {renderItemStatus(item)}

                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <ItemIcon className="h-4 w-4 text-blue-600" />
                            <span className="font-medium">{item.title}</span>
                            <Badge variant="outline" className="text-xs">
                              {item.itemType}
                            </Badge>
                            {item.isRequired && (
                              <Badge variant="secondary" className="text-xs">
                                Required
                              </Badge>
                            )}
                          </div>

                          {item.description && (
                            <p className="text-sm text-gray-600 mb-2">
                              {item.description}
                            </p>
                          )}

                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {Math.round(item.estimatedDuration / 60)}h
                            </div>

                            {item.progress && (
                              <div className={`font-medium ${STATUS_COLORS[status]}`}>
                                {status === 'COMPLETED' && item.progress.score &&
                                  `Score: ${Math.round(item.progress.score)}%`
                                }
                                {status === 'IN_PROGRESS' &&
                                  `${Math.round(item.progress.progressPercentage)}% complete`
                                }
                                {status === 'NOT_STARTED' && 'Not started'}
                                {status === 'SKIPPED' && 'Skipped'}
                              </div>
                            )}
                          </div>

                          {item.progress && item.progress.status === 'IN_PROGRESS' && (
                            <Progress
                              value={item.progress.progressPercentage}
                              className="w-48 mt-2"
                            />
                          )}
                        </div>

                        {unlocked && isEnrolled && (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card>
              <CardHeader>
                <CardTitle>Skills You'll Gain</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3">
                  {path.skills.map(skill => (
                    <div key={skill} className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      <span className="font-medium text-blue-900">{skill}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Learning Outcomes</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {path.learningObjectives.map((objective, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <Target className="h-4 w-4 text-green-600 mt-1 flex-shrink-0" />
                      <span className="text-gray-700">{objective}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Reviews Tab */}
        <TabsContent value="reviews" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Learner Reviews</CardTitle>
              <p className="text-gray-600">
                Average rating: {path.averageRating.toFixed(1)} out of 5 stars
              </p>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                Reviews feature coming soon...
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Prerequisites Dialog */}
      <Dialog open={showPrerequisites} onOpenChange={setShowPrerequisites}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prerequisites Required</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-gray-600">
              You need to complete the following prerequisites before enrolling in this learning path:
            </p>
            <div className="space-y-3">
              {path.dependencies
                ?.filter(dep => dep.dependencyType === 'REQUIRED')
                .map(dep => (
                  <div key={dep.id} className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <div>
                      <div className="font-medium">{dep.prerequisitePathTitle}</div>
                      <div className="text-sm text-gray-600">
                        {dep.minimumCompletionPercentage}% completion required
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}