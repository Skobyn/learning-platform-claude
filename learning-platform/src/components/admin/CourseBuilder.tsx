'use client';

import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
// import {
//   DragDropContext,
//   Droppable,
//   Draggable,
//   DropResult,
// } from 'react-beautiful-dnd';
import {
  BookOpen,
  Plus,
  Trash2,
  Edit3,
  Save,
  Eye,
  Upload,
  Video,
  FileText,
  Image,
  Link,
  Clock,
  Users,
  Target,
  Lightbulb,
  Wand2,
  Sparkles,
  Play,
  GripVertical,
  Settings,
  Check,
  X,
  RefreshCw
} from 'lucide-react';
import { Course, CourseModule, ModuleContent, ContentType, CourseLevel } from '@/types';

interface AIGeneratedContent {
  title: string;
  description: string;
  modules: {
    title: string;
    description: string;
    duration: number;
    content: {
      type: ContentType;
      title: string;
      content?: string;
      order: number;
    }[];
  }[];
  tags: string[];
  prerequisites: string[];
  estimatedDuration: number;
  level: CourseLevel;
}

interface AIPrompt {
  topic: string;
  audience: string;
  level: CourseLevel;
  duration: string;
  format: string;
  goals: string;
  includeQuizzes: boolean;
  includeProjects: boolean;
}

export function CourseBuilder() {
  const [course, setCourse] = useState<Partial<Course>>({
    title: '',
    description: '',
    level: CourseLevel.BEGINNER,
    duration: 0,
    prerequisites: [],
    tags: [],
    modules: []
  });
  
  const [activeTab, setActiveTab] = useState('builder');
  const [selectedModule, setSelectedModule] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState<AIPrompt>({
    topic: '',
    audience: '',
    level: CourseLevel.BEGINNER,
    duration: '',
    format: '',
    goals: '',
    includeQuizzes: true,
    includeProjects: false
  });
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAIGeneration = async () => {
    setAiGenerating(true);
    try {
      // Simulate AI API call
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const aiContent: AIGeneratedContent = {
        title: `Complete ${aiPrompt.topic} Course`,
        description: `A comprehensive ${aiPrompt.level} course on ${aiPrompt.topic} designed for ${aiPrompt.audience}. ${aiPrompt.goals}`,
        level: aiPrompt.level,
        estimatedDuration: parseInt(aiPrompt.duration) || 120,
        tags: [aiPrompt.topic.toLowerCase(), aiPrompt.level, 'ai-generated'],
        prerequisites: aiPrompt.level === CourseLevel.BEGINNER ? [] : ['Basic programming knowledge'],
        modules: [
          {
            title: `Introduction to ${aiPrompt.topic}`,
            description: `Getting started with ${aiPrompt.topic} fundamentals`,
            duration: 30,
            content: [
              {
                type: ContentType.TEXT,
                title: 'Course Overview',
                content: 'Welcome to this comprehensive course...',
                order: 1
              },
              {
                type: ContentType.VIDEO,
                title: 'Introduction Video',
                order: 2
              }
            ]
          },
          {
            title: `Core Concepts`,
            description: `Essential ${aiPrompt.topic} concepts and principles`,
            duration: 45,
            content: [
              {
                type: ContentType.TEXT,
                title: 'Key Principles',
                content: 'In this section, we will explore...',
                order: 1
              },
              {
                type: ContentType.INTERACTIVE,
                title: 'Hands-on Exercise',
                order: 2
              }
            ]
          },
          {
            title: `Practical Application`,
            description: `Real-world applications and projects`,
            duration: 45,
            content: [
              {
                type: ContentType.VIDEO,
                title: 'Project Walkthrough',
                order: 1
              },
              {
                type: ContentType.FILE,
                title: 'Project Resources',
                order: 2
              }
            ]
          }
        ]
      };
      
      // Apply AI-generated content to course
      setCourse(prev => ({
        ...prev,
        title: aiContent.title,
        description: aiContent.description,
        level: aiContent.level,
        duration: aiContent.estimatedDuration,
        tags: aiContent.tags,
        prerequisites: aiContent.prerequisites,
        modules: aiContent.modules.map((module, index) => ({
          id: `module-${index}`,
          courseId: '',
          title: module.title,
          description: module.description,
          order: index + 1,
          duration: module.duration,
          content: module.content.map((content, contentIndex) => ({
            id: `content-${index}-${contentIndex}`,
            moduleId: `module-${index}`,
            type: content.type,
            title: content.title,
            content: content.content || '',
            order: content.order,
            createdAt: new Date(),
            updatedAt: new Date()
          })),
          createdAt: new Date(),
          updatedAt: new Date()
        }))
      }));
      
      setAiDialogOpen(false);
    } catch (error) {
      console.error('AI generation failed:', error);
    } finally {
      setAiGenerating(false);
    }
  };

  const addModule = () => {
    const newModule: CourseModule = {
      id: `module-${Date.now()}`,
      courseId: '',
      title: 'New Module',
      description: '',
      order: (course.modules?.length || 0) + 1,
      duration: 30,
      content: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    setCourse(prev => ({
      ...prev,
      modules: [...(prev.modules || []), newModule]
    }));
  };

  const removeModule = (moduleId: string) => {
    setCourse(prev => ({
      ...prev,
      modules: (prev.modules || []).filter(m => m.id !== moduleId)
    }));
  };

  const updateModule = (moduleId: string, updates: Partial<CourseModule>) => {
    setCourse(prev => ({
      ...prev,
      modules: (prev.modules || []).map(m => 
        m.id === moduleId ? { ...m, ...updates } : m
      )
    }));
  };

  const addContentToModule = (moduleId: string, contentType: ContentType) => {
    const module = course.modules?.find(m => m.id === moduleId);
    if (!module) return;

    const newContent: ModuleContent = {
      id: `content-${Date.now()}`,
      moduleId,
      type: contentType,
      title: `New ${contentType}`,
      order: module.content.length + 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    updateModule(moduleId, {
      content: [...module.content, newContent]
    });
  };

  const removeContent = (moduleId: string, contentId: string) => {
    const module = course.modules?.find(m => m.id === moduleId);
    if (!module) return;

    updateModule(moduleId, {
      content: module.content.filter(c => c.id !== contentId)
    });
  };

  const onDragEnd = (result: any) => {
    // Simplified drag and drop logic
    console.log('Drag and drop functionality coming soon');
  };

  const getContentIcon = (type: ContentType) => {
    switch (type) {
      case ContentType.TEXT:
        return <FileText className="h-4 w-4" />;
      case ContentType.VIDEO:
        return <Video className="h-4 w-4" />;
      case ContentType.FILE:
        return <Upload className="h-4 w-4" />;
      case ContentType.INTERACTIVE:
        return <Play className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const saveCourse = async () => {
    try {
      // TODO: Implement API call to save course
      console.log('Saving course:', course);
      // Show success message
    } catch (error) {
      console.error('Failed to save course:', error);
    }
  };

  const publishCourse = async () => {
    try {
      // TODO: Implement API call to publish course
      console.log('Publishing course:', course);
      setCourse(prev => ({ ...prev, isPublished: true }));
    } catch (error) {
      console.error('Failed to publish course:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Course Builder</h2>
          <p className="text-gray-600 mt-1">Create and manage your courses</p>
        </div>
        <div className="flex space-x-4">
          <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Wand2 className="h-4 w-4 mr-2" />
                AI Assistant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle className="flex items-center">
                  <Sparkles className="h-5 w-5 mr-2 text-purple-600" />
                  AI Course Generator
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Course Topic</label>
                    <Input
                      placeholder="e.g., React Development"
                      value={aiPrompt.topic}
                      onChange={(e) => setAiPrompt(prev => ({ ...prev, topic: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Target Audience</label>
                    <Input
                      placeholder="e.g., Web developers"
                      value={aiPrompt.audience}
                      onChange={(e) => setAiPrompt(prev => ({ ...prev, audience: e.target.value }))}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Course Level</label>
                    <Select 
                      value={aiPrompt.level} 
                      onValueChange={(value) => setAiPrompt(prev => ({ ...prev, level: value as CourseLevel }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CourseLevel.BEGINNER}>Beginner</SelectItem>
                        <SelectItem value={CourseLevel.INTERMEDIATE}>Intermediate</SelectItem>
                        <SelectItem value={CourseLevel.ADVANCED}>Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Duration (minutes)</label>
                    <Input
                      placeholder="e.g., 120"
                      value={aiPrompt.duration}
                      onChange={(e) => setAiPrompt(prev => ({ ...prev, duration: e.target.value }))}
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Learning Goals</label>
                  <Textarea
                    placeholder="What should learners achieve after completing this course?"
                    value={aiPrompt.goals}
                    onChange={(e) => setAiPrompt(prev => ({ ...prev, goals: e.target.value }))}
                    rows={3}
                  />
                </div>
                
                <div className="flex items-center space-x-6">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={aiPrompt.includeQuizzes}
                      onChange={(e) => setAiPrompt(prev => ({ ...prev, includeQuizzes: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-sm">Include Quizzes</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={aiPrompt.includeProjects}
                      onChange={(e) => setAiPrompt(prev => ({ ...prev, includeProjects: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-sm">Include Projects</span>
                  </label>
                </div>
                
                <Button 
                  onClick={handleAIGeneration} 
                  disabled={aiGenerating || !aiPrompt.topic || !aiPrompt.audience}
                  className="w-full"
                >
                  {aiGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Generating Course...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Course
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          
          <Button variant="outline" onClick={() => setShowPreview(!showPreview)}>
            <Eye className="h-4 w-4 mr-2" />
            {showPreview ? 'Edit' : 'Preview'}
          </Button>
          <Button onClick={saveCourse}>
            <Save className="h-4 w-4 mr-2" />
            Save Draft
          </Button>
          <Button onClick={publishCourse}>
            <Check className="h-4 w-4 mr-2" />
            Publish
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="builder">Course Builder</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="space-y-6">
          {/* Course Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Course Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Course Title</label>
                  <Input
                    placeholder="Enter course title"
                    value={course.title || ''}
                    onChange={(e) => setCourse(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Level</label>
                  <Select 
                    value={course.level || ''} 
                    onValueChange={(value) => setCourse(prev => ({ ...prev, level: value as CourseLevel }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CourseLevel.BEGINNER}>Beginner</SelectItem>
                      <SelectItem value={CourseLevel.INTERMEDIATE}>Intermediate</SelectItem>
                      <SelectItem value={CourseLevel.ADVANCED}>Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <Textarea
                  placeholder="Describe your course"
                  value={course.description || ''}
                  onChange={(e) => setCourse(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Duration (minutes)</label>
                  <Input
                    type="number"
                    placeholder="120"
                    value={course.duration || 0}
                    onChange={(e) => setCourse(prev => ({ ...prev, duration: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Tags</label>
                  <Input
                    placeholder="javascript, react, frontend (comma separated)"
                    value={(course.tags || []).join(', ')}
                    onChange={(e) => setCourse(prev => ({ 
                      ...prev, 
                      tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean)
                    }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Course Modules */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Course Modules</CardTitle>
                <Button onClick={addModule}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Module
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {(course.modules || []).map((module, moduleIndex) => (
                    <Card key={module.id} className="border-l-4 border-l-blue-500">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <GripVertical className="h-4 w-4 text-gray-400" />
                              <Input
                                value={module.title}
                                onChange={(e) => updateModule(module.id, { title: e.target.value })}
                                className="font-medium border-none p-0 h-auto bg-transparent"
                                placeholder="Module title"
                              />
                            </div>
                            <Textarea
                              value={module.description}
                              onChange={(e) => updateModule(module.id, { description: e.target.value })}
                              className="mt-2 text-sm border-none p-0 bg-transparent resize-none"
                              placeholder="Module description"
                              rows={2}
                            />
                            <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                              <div className="flex items-center">
                                <Clock className="h-3 w-3 mr-1" />
                                <Input
                                  type="number"
                                  value={module.duration}
                                  onChange={(e) => updateModule(module.id, { duration: parseInt(e.target.value) || 0 })}
                                  className="w-16 h-6 text-xs border-none p-0 bg-transparent"
                                /> min
                              </div>
                              <div className="flex items-center">
                                <FileText className="h-3 w-3 mr-1" />
                                {module.content.length} items
                              </div>
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setSelectedModule(selectedModule === moduleIndex ? null : moduleIndex)}
                            >
                              {selectedModule === moduleIndex ? <X className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => removeModule(module.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      
                      {selectedModule === moduleIndex && (
                        <CardContent>
                          <div className="space-y-4">
                            <div className="flex space-x-2 pb-3 border-b">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => addContentToModule(module.id, ContentType.TEXT)}
                              >
                                <FileText className="h-4 w-4 mr-1" />
                                Text
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => addContentToModule(module.id, ContentType.VIDEO)}
                              >
                                <Video className="h-4 w-4 mr-1" />
                                Video
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => addContentToModule(module.id, ContentType.FILE)}
                              >
                                <Upload className="h-4 w-4 mr-1" />
                                File
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => addContentToModule(module.id, ContentType.INTERACTIVE)}
                              >
                                <Play className="h-4 w-4 mr-1" />
                                Interactive
                              </Button>
                            </div>
                            
                            <div className="space-y-2">
                              {module.content.map((content, contentIndex) => (
                                <div
                                  key={content.id}
                                  className="flex items-center justify-between p-3 bg-gray-50 rounded border"
                                >
                                  <div className="flex items-center space-x-3">
                                    <GripVertical className="h-4 w-4 text-gray-400" />
                                    {getContentIcon(content.type)}
                                    <div>
                                      <Input
                                        value={content.title}
                                        onChange={(e) => {
                                          const updatedContent = module.content.map(c => 
                                            c.id === content.id ? { ...c, title: e.target.value } : c
                                          );
                                          updateModule(module.id, { content: updatedContent });
                                        }}
                                        className="font-medium border-none p-0 h-auto bg-transparent"
                                        placeholder="Content title"
                                      />
                                      <Badge variant="outline" className="text-xs mt-1">
                                        {content.type}
                                      </Badge>
                                    </div>
                                  </div>
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => removeContent(module.id, content.id)}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              
              {(!course.modules || course.modules.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No modules yet. Add your first module to get started.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Course Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">Prerequisites</label>
                <Textarea
                  placeholder="List course prerequisites (one per line)"
                  value={(course.prerequisites || []).join('\n')}
                  onChange={(e) => setCourse(prev => ({
                    ...prev,
                    prerequisites: e.target.value.split('\n').filter(Boolean)
                  }))}
                  rows={4}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Course Thumbnail</label>
                <div className="flex items-center space-x-4">
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Thumbnail
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        // TODO: Handle file upload
                        console.log('File selected:', file);
                      }
                    }}
                  />
                  {course.thumbnailUrl && (
                    <img 
                      src={course.thumbnailUrl} 
                      alt="Thumbnail" 
                      className="h-16 w-16 object-cover rounded"
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview">
          <Card>
            <CardHeader>
              <CardTitle>Course Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold">{course.title || 'Untitled Course'}</h3>
                  <p className="text-gray-600 mt-2">{course.description}</p>
                  <div className="flex items-center space-x-4 mt-4">
                    <Badge>{course.level}</Badge>
                    <div className="flex items-center text-sm text-gray-500">
                      <Clock className="h-4 w-4 mr-1" />
                      {course.duration} minutes
                    </div>
                    <div className="flex items-center text-sm text-gray-500">
                      <BookOpen className="h-4 w-4 mr-1" />
                      {course.modules?.length || 0} modules
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h4 className="font-medium mb-4">Course Modules</h4>
                  <div className="space-y-3">
                    {(course.modules || []).map((module, index) => (
                      <div key={module.id} className="border rounded p-4">
                        <div className="flex items-center justify-between">
                          <h5 className="font-medium">{index + 1}. {module.title}</h5>
                          <div className="flex items-center text-sm text-gray-500">
                            <Clock className="h-3 w-3 mr-1" />
                            {module.duration}m
                          </div>
                        </div>
                        <p className="text-gray-600 text-sm mt-1">{module.description}</p>
                        <div className="mt-2 space-y-1">
                          {module.content.map((content) => (
                            <div key={content.id} className="flex items-center space-x-2 text-sm">
                              {getContentIcon(content.type)}
                              <span>{content.title}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}