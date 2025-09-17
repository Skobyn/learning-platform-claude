'use client';

import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus,
  X,
  GripVertical,
  Search,
  BookOpen,
  Clock,
  Users,
  Star,
  ChevronRight,
  Settings,
  Eye,
  Save,
  Publish
} from 'lucide-react';

interface Course {
  id: string;
  title: string;
  description: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  duration: number;
  thumbnailUrl?: string;
  instructor: {
    name: string;
  };
  _count: {
    enrollments: number;
  };
}

interface LearningPath {
  id: string;
  title: string;
  description: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  estimatedHours: number;
  tags: string[];
  isPublic: boolean;
  price?: number;
}

interface Prerequisite {
  id: string;
  type: 'path' | 'skill' | 'course';
  pathId?: string;
  pathTitle?: string;
  skillLevel?: number;
  requiredCourses?: string[];
}

interface PathBuilderProps {
  pathId?: string;
  onSave?: (path: LearningPath) => void;
  onPublish?: (path: LearningPath) => void;
}

export default function PathBuilder({ pathId, onSave, onPublish }: PathBuilderProps) {
  const [pathData, setPathData] = useState<Partial<LearningPath>>({
    title: '',
    description: '',
    level: 'BEGINNER',
    estimatedHours: 0,
    tags: [],
    isPublic: true,
    price: 0
  });

  const [selectedCourses, setSelectedCourses] = useState<Course[]>([]);
  const [availableCourses, setAvailableCourses] = useState<Course[]>([]);
  const [prerequisites, setPrerequisites] = useState<Prerequisite[]>([]);
  const [availablePaths, setAvailablePaths] = useState<LearningPath[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');

  const [courseSearchDialog, setCourseSearchDialog] = useState(false);
  const [prerequisiteDialog, setPrerequisiteDialog] = useState(false);

  useEffect(() => {
    loadAvailableCourses();
    loadAvailablePaths();

    if (pathId) {
      loadExistingPath();
    }
  }, [pathId]);

  const loadAvailableCourses = async () => {
    try {
      const response = await fetch('/api/courses?limit=100');
      const data = await response.json();
      setAvailableCourses(data.courses || []);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  const loadAvailablePaths = async () => {
    try {
      const response = await fetch('/api/paths?limit=50');
      const data = await response.json();
      setAvailablePaths(data.paths || []);
    } catch (error) {
      console.error('Failed to load paths:', error);
    }
  };

  const loadExistingPath = async () => {
    if (!pathId) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/paths/${pathId}`);
      const path = await response.json();

      setPathData(path);
      setSelectedCourses(path.courses || []);
      setPrerequisites(path.prerequisites || []);
    } catch (error) {
      console.error('Failed to load path:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const items = Array.from(selectedCourses);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setSelectedCourses(items);
  };

  const addCourse = (course: Course) => {
    if (!selectedCourses.find(c => c.id === course.id)) {
      setSelectedCourses([...selectedCourses, course]);
      updateEstimatedHours([...selectedCourses, course]);
    }
    setCourseSearchDialog(false);
  };

  const removeCourse = (courseId: string) => {
    const updated = selectedCourses.filter(c => c.id !== courseId);
    setSelectedCourses(updated);
    updateEstimatedHours(updated);
  };

  const updateEstimatedHours = (courses: Course[]) => {
    const totalHours = courses.reduce((sum, course) => sum + course.duration, 0);
    setPathData(prev => ({ ...prev, estimatedHours: Math.ceil(totalHours / 60) }));
  };

  const addTag = () => {
    if (tagInput.trim() && !pathData.tags?.includes(tagInput.trim())) {
      setPathData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setPathData(prev => ({
      ...prev,
      tags: prev.tags?.filter(t => t !== tag) || []
    }));
  };

  const addPrerequisite = (prerequisite: Omit<Prerequisite, 'id'>) => {
    setPrerequisites(prev => [
      ...prev,
      { ...prerequisite, id: Date.now().toString() }
    ]);
    setPrerequisiteDialog(false);
  };

  const removePrerequisite = (id: string) => {
    setPrerequisites(prev => prev.filter(p => p.id !== id));
  };

  const handleSave = async () => {
    if (!pathData.title || selectedCourses.length === 0) {
      alert('Please provide a title and select at least one course');
      return;
    }

    try {
      setIsLoading(true);

      const payload = {
        ...pathData,
        courseIds: selectedCourses.map(c => c.id),
        prerequisites: prerequisites.map(p => ({
          pathId: p.pathId,
          skillLevel: p.skillLevel,
          requiredCourses: p.requiredCourses
        }))
      };

      const url = pathId ? `/api/paths/${pathId}` : '/api/paths';
      const method = pathId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to save learning path');
      }

      const savedPath = await response.json();
      onSave?.(savedPath);
    } catch (error) {
      console.error('Failed to save path:', error);
      alert('Failed to save learning path');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePublish = async () => {
    await handleSave();

    if (pathId) {
      try {
        const response = await fetch(`/api/paths/${pathId}/publish`, {
          method: 'POST'
        });

        if (response.ok) {
          const publishedPath = await response.json();
          onPublish?.(publishedPath);
        }
      } catch (error) {
        console.error('Failed to publish path:', error);
      }
    }
  };

  const filteredCourses = availableCourses.filter(course =>
    course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    course.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {pathId ? 'Edit Learning Path' : 'Create Learning Path'}
          </h1>
          <p className="text-gray-600 mt-2">
            Build a structured learning journey with curated courses and prerequisites
          </p>
        </div>

        <div className="flex space-x-3">
          <Button variant="outline" onClick={handleSave} disabled={isLoading}>
            <Save className="w-4 h-4 mr-2" />
            Save Draft
          </Button>
          <Button onClick={handlePublish} disabled={isLoading}>
            <Publish className="w-4 h-4 mr-2" />
            Publish Path
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="prerequisites">Prerequisites</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="title">Path Title *</Label>
                <Input
                  id="title"
                  value={pathData.title}
                  onChange={(e) => setPathData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Full-Stack Web Development Mastery"
                />
              </div>

              <div>
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  value={pathData.description}
                  onChange={(e) => setPathData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe what learners will achieve..."
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="level">Difficulty Level</Label>
                  <Select
                    value={pathData.level}
                    onValueChange={(value: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED') =>
                      setPathData(prev => ({ ...prev, level: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BEGINNER">Beginner</SelectItem>
                      <SelectItem value="INTERMEDIATE">Intermediate</SelectItem>
                      <SelectItem value="ADVANCED">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="price">Price ($)</Label>
                  <Input
                    id="price"
                    type="number"
                    min="0"
                    value={pathData.price || 0}
                    onChange={(e) => setPathData(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div>
                <Label>Tags</Label>
                <div className="flex items-center space-x-2 mt-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="Add a tag..."
                    onKeyPress={(e) => e.key === 'Enter' && addTag()}
                  />
                  <Button type="button" onClick={addTag} size="sm">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {pathData.tags?.map((tag) => (
                    <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                      {tag}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => removeTag(tag)}
                      />
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <Label className="text-base font-medium">Public Path</Label>
                  <p className="text-sm text-gray-600">
                    Make this path discoverable by other learners
                  </p>
                </div>
                <Switch
                  checked={pathData.isPublic}
                  onCheckedChange={(checked) => setPathData(prev => ({ ...prev, isPublic: checked }))}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="courses" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Course Sequence</CardTitle>
                <Dialog open={courseSearchDialog} onOpenChange={setCourseSearchDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Course
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Add Courses to Path</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <Input
                          placeholder="Search courses..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-10"
                        />
                      </div>

                      <div className="grid gap-4 max-h-96 overflow-y-auto">
                        {filteredCourses.map((course) => (
                          <div
                            key={course.id}
                            className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                          >
                            <div className="flex items-start space-x-3">
                              <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
                                <BookOpen className="w-8 h-8 text-blue-600" />
                              </div>
                              <div className="flex-1">
                                <h3 className="font-semibold text-gray-900">{course.title}</h3>
                                <p className="text-sm text-gray-600 mt-1">{course.description}</p>
                                <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                                  <div className="flex items-center">
                                    <Clock className="w-4 h-4 mr-1" />
                                    {Math.ceil(course.duration / 60)}h
                                  </div>
                                  <div className="flex items-center">
                                    <Users className="w-4 h-4 mr-1" />
                                    {course._count.enrollments}
                                  </div>
                                  <Badge variant="outline">{course.level}</Badge>
                                </div>
                              </div>
                            </div>
                            <Button
                              onClick={() => addCourse(course)}
                              disabled={selectedCourses.some(c => c.id === course.id)}
                            >
                              {selectedCourses.some(c => c.id === course.id) ? 'Added' : 'Add'}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {selectedCourses.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No courses selected</h3>
                  <p className="text-gray-600 mb-4">Add courses to create your learning path</p>
                  <Button onClick={() => setCourseSearchDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add First Course
                  </Button>
                </div>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="courses">
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                        {selectedCourses.map((course, index) => (
                          <Draggable key={course.id} draggableId={course.id} index={index}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className="flex items-center space-x-3 p-4 border rounded-lg bg-white"
                              >
                                <div {...provided.dragHandleProps} className="text-gray-400">
                                  <GripVertical className="w-5 h-5" />
                                </div>

                                <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-full text-blue-600 font-semibold">
                                  {index + 1}
                                </div>

                                <div className="flex-1">
                                  <h3 className="font-semibold text-gray-900">{course.title}</h3>
                                  <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
                                    <div className="flex items-center">
                                      <Clock className="w-4 h-4 mr-1" />
                                      {Math.ceil(course.duration / 60)}h
                                    </div>
                                    <Badge variant="outline">{course.level}</Badge>
                                  </div>
                                </div>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeCourse(course.id)}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}

              {selectedCourses.length > 0 && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-700">Total estimated time:</span>
                    <span className="font-semibold text-blue-900">
                      {pathData.estimatedHours} hours
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prerequisites" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Prerequisites</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Define what learners need before starting this path
                  </p>
                </div>
                <Dialog open={prerequisiteDialog} onOpenChange={setPrerequisiteDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Prerequisite
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Prerequisite</DialogTitle>
                    </DialogHeader>
                    <PrerequisiteForm
                      availablePaths={availablePaths}
                      availableCourses={availableCourses}
                      onAdd={addPrerequisite}
                      onCancel={() => setPrerequisiteDialog(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {prerequisites.length === 0 ? (
                <div className="text-center py-8">
                  <Settings className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-600">No prerequisites set</p>
                  <p className="text-sm text-gray-500 mt-1">
                    This path will be available to all learners
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {prerequisites.map((prereq) => (
                    <div key={prereq.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        {prereq.type === 'path' && (
                          <div>
                            <span className="text-sm font-medium">Complete Path:</span>
                            <span className="ml-2 text-blue-600">{prereq.pathTitle}</span>
                          </div>
                        )}
                        {prereq.type === 'skill' && (
                          <div>
                            <span className="text-sm font-medium">Skill Level:</span>
                            <span className="ml-2">Level {prereq.skillLevel} or higher</span>
                          </div>
                        )}
                        {prereq.type === 'course' && (
                          <div>
                            <span className="text-sm font-medium">Complete Courses:</span>
                            <span className="ml-2">{prereq.requiredCourses?.length} courses</span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removePrerequisite(prereq.id)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Eye className="w-5 h-5 mr-2" />
                Path Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PathPreview
                pathData={pathData}
                courses={selectedCourses}
                prerequisites={prerequisites}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PrerequisiteForm({
  availablePaths,
  availableCourses,
  onAdd,
  onCancel
}: {
  availablePaths: LearningPath[];
  availableCourses: Course[];
  onAdd: (prerequisite: Omit<Prerequisite, 'id'>) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'path' | 'skill' | 'course'>('path');
  const [selectedPath, setSelectedPath] = useState('');
  const [skillLevel, setSkillLevel] = useState(1);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);

  const handleSubmit = () => {
    if (type === 'path' && selectedPath) {
      const path = availablePaths.find(p => p.id === selectedPath);
      onAdd({
        type: 'path',
        pathId: selectedPath,
        pathTitle: path?.title
      });
    } else if (type === 'skill') {
      onAdd({
        type: 'skill',
        skillLevel
      });
    } else if (type === 'course' && selectedCourses.length > 0) {
      onAdd({
        type: 'course',
        requiredCourses: selectedCourses
      });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Prerequisite Type</Label>
        <Select value={type} onValueChange={(value: 'path' | 'skill' | 'course') => setType(value)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="path">Complete Another Path</SelectItem>
            <SelectItem value="skill">Skill Level Requirement</SelectItem>
            <SelectItem value="course">Specific Courses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {type === 'path' && (
        <div>
          <Label>Required Learning Path</Label>
          <Select value={selectedPath} onValueChange={setSelectedPath}>
            <SelectTrigger>
              <SelectValue placeholder="Select a learning path" />
            </SelectTrigger>
            <SelectContent>
              {availablePaths.map((path) => (
                <SelectItem key={path.id} value={path.id}>
                  {path.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {type === 'skill' && (
        <div>
          <Label>Minimum Skill Level</Label>
          <Select value={skillLevel.toString()} onValueChange={(value) => setSkillLevel(parseInt(value))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((level) => (
                <SelectItem key={level} value={level.toString()}>
                  Level {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {type === 'course' && (
        <div>
          <Label>Required Courses</Label>
          <div className="max-h-40 overflow-y-auto border rounded-md p-2">
            {availableCourses.map((course) => (
              <div key={course.id} className="flex items-center space-x-2 py-1">
                <input
                  type="checkbox"
                  id={course.id}
                  checked={selectedCourses.includes(course.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedCourses([...selectedCourses, course.id]);
                    } else {
                      setSelectedCourses(selectedCourses.filter(id => id !== course.id));
                    }
                  }}
                />
                <label htmlFor={course.id} className="text-sm">
                  {course.title}
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={
            (type === 'path' && !selectedPath) ||
            (type === 'course' && selectedCourses.length === 0)
          }
        >
          Add Prerequisite
        </Button>
      </div>
    </div>
  );
}

function PathPreview({
  pathData,
  courses,
  prerequisites
}: {
  pathData: Partial<LearningPath>;
  courses: Course[];
  prerequisites: Prerequisite[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{pathData.title || 'Untitled Path'}</h2>
        <p className="text-gray-600 mb-4">{pathData.description || 'No description provided'}</p>

        <div className="flex items-center space-x-4 text-sm text-gray-500">
          <div className="flex items-center">
            <Clock className="w-4 h-4 mr-1" />
            {pathData.estimatedHours || 0} hours
          </div>
          <Badge variant="outline">{pathData.level}</Badge>
          <div className="flex items-center">
            <BookOpen className="w-4 h-4 mr-1" />
            {courses.length} courses
          </div>
          {pathData.price && pathData.price > 0 && (
            <div className="font-semibold text-green-600">
              ${pathData.price}
            </div>
          )}
        </div>

        {pathData.tags && pathData.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {pathData.tags.map((tag) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </div>
        )}
      </div>

      {prerequisites.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Prerequisites</h3>
          <div className="space-y-2">
            {prerequisites.map((prereq, index) => (
              <div key={index} className="flex items-center p-3 bg-yellow-50 rounded-lg">
                <div className="w-6 h-6 bg-yellow-100 rounded-full flex items-center justify-center mr-3">
                  <span className="text-yellow-600 text-sm font-semibold">{index + 1}</span>
                </div>
                <div className="text-sm">
                  {prereq.type === 'path' && `Complete "${prereq.pathTitle}"`}
                  {prereq.type === 'skill' && `Skill Level ${prereq.skillLevel} or higher`}
                  {prereq.type === 'course' && `Complete ${prereq.requiredCourses?.length} required courses`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold mb-3">Course Sequence</h3>
        <div className="space-y-3">
          {courses.map((course, index) => (
            <div key={course.id} className="flex items-center space-x-4 p-4 border rounded-lg">
              <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-full">
                <span className="text-blue-600 font-semibold">{index + 1}</span>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-gray-900">{course.title}</h4>
                <div className="flex items-center space-x-3 mt-1 text-sm text-gray-500">
                  <div className="flex items-center">
                    <Clock className="w-4 h-4 mr-1" />
                    {Math.ceil(course.duration / 60)}h
                  </div>
                  <Badge variant="outline">{course.level}</Badge>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}