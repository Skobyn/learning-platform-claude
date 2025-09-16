'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  Plus,
  Brain,
  FileText,
  CheckCircle2,
  X,
  Edit3,
  Trash2,
  Copy,
  Play,
  BarChart3,
  Clock,
  Target,
  Users,
  Lightbulb,
  Wand2,
  RefreshCw,
  Save,
  Eye,
  Settings,
  HelpCircle,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from 'lucide-react';
import { Quiz, Question, QuestionType, QuizAttempt } from '@/types';
import { formatDate } from '@/lib/utils';

interface QuizWithStats extends Quiz {
  attemptCount: number;
  averageScore: number;
  passRate: number;
  averageTime: number;
}

interface QuestionFormData {
  question: string;
  options: string[];
  correctAnswer: string | string[];
  explanation?: string;
  points: number;
  type: QuestionType;
}

interface AIPrompt {
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  questionCount: number;
  includeExplanations: boolean;
  questionTypes: QuestionType[];
}

export function QuizBuilder() {
  const [quizzes, setQuizzes] = useState<QuizWithStats[]>([
    {
      id: '1',
      moduleId: 'module-1',
      title: 'React Fundamentals Quiz',
      description: 'Test your knowledge of React basics',
      timeLimit: 30,
      passingScore: 70,
      createdAt: new Date('2024-01-15'),
      updatedAt: new Date('2024-01-20'),
      questions: [
        {
          id: 'q1',
          quizId: '1',
          type: QuestionType.MULTIPLE_CHOICE,
          question: 'What is JSX?',
          options: ['A JavaScript extension', 'A CSS framework', 'A database', 'A testing library'],
          correctAnswer: 'A JavaScript extension',
          explanation: 'JSX is a syntax extension for JavaScript that looks similar to XML or HTML.',
          points: 10,
          order: 1
        },
        {
          id: 'q2',
          quizId: '1',
          type: QuestionType.TRUE_FALSE,
          question: 'React components must always return JSX.',
          options: ['True', 'False'],
          correctAnswer: 'False',
          explanation: 'React components can return JSX, strings, numbers, arrays, or null.',
          points: 5,
          order: 2
        }
      ],
      attemptCount: 145,
      averageScore: 78.5,
      passRate: 82.1,
      averageTime: 18.5
    },
    {
      id: '2',
      moduleId: 'module-2',
      title: 'JavaScript ES6+ Features',
      description: 'Advanced JavaScript concepts and modern features',
      timeLimit: 45,
      passingScore: 75,
      createdAt: new Date('2024-01-10'),
      updatedAt: new Date('2024-01-18'),
      questions: [
        {
          id: 'q3',
          quizId: '2',
          type: QuestionType.MULTIPLE_CHOICE,
          question: 'Which of the following is NOT a valid way to declare a variable in ES6?',
          options: ['let', 'const', 'var', 'def'],
          correctAnswer: 'def',
          explanation: 'In JavaScript, variables can be declared with let, const, or var. "def" is not a valid keyword.',
          points: 10,
          order: 1
        }
      ],
      attemptCount: 89,
      averageScore: 72.3,
      passRate: 68.5,
      averageTime: 28.7
    }
  ]);

  const [selectedQuiz, setSelectedQuiz] = useState<QuizWithStats | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showQuizDialog, setShowQuizDialog] = useState(false);
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  
  const [aiPrompt, setAiPrompt] = useState<AIPrompt>({
    topic: '',
    difficulty: 'intermediate',
    questionCount: 5,
    includeExplanations: true,
    questionTypes: [QuestionType.MULTIPLE_CHOICE, QuestionType.TRUE_FALSE]
  });

  const [questionForm, setQuestionForm] = useState<QuestionFormData>({
    question: '',
    options: ['', '', '', ''],
    correctAnswer: '',
    explanation: '',
    points: 10,
    type: QuestionType.MULTIPLE_CHOICE
  });

  const questionBank = [
    {
      id: 'qb1',
      category: 'React',
      difficulty: 'Beginner',
      question: 'What is the virtual DOM?',
      type: QuestionType.MULTIPLE_CHOICE,
      usageCount: 23
    },
    {
      id: 'qb2',
      category: 'JavaScript',
      difficulty: 'Intermediate',
      question: 'Explain the difference between let and var',
      type: QuestionType.SHORT_ANSWER,
      usageCount: 18
    },
    {
      id: 'qb3',
      category: 'CSS',
      difficulty: 'Advanced',
      question: 'What is the CSS box model?',
      type: QuestionType.ESSAY,
      usageCount: 12
    }
  ];

  const handleCreateQuiz = () => {
    setSelectedQuiz(null);
    setShowQuizDialog(true);
  };

  const handleEditQuiz = (quiz: QuizWithStats) => {
    setSelectedQuiz(quiz);
    setShowQuizDialog(true);
  };

  const handleDeleteQuiz = (quiz: QuizWithStats) => {
    if (confirm(`Are you sure you want to delete "${quiz.title}"?`)) {
      setQuizzes(prev => prev.filter(q => q.id !== quiz.id));
    }
  };

  const handleAddQuestion = (quiz: QuizWithStats) => {
    setSelectedQuiz(quiz);
    setEditingQuestion(null);
    setQuestionForm({
      question: '',
      options: ['', '', '', ''],
      correctAnswer: '',
      explanation: '',
      points: 10,
      type: QuestionType.MULTIPLE_CHOICE
    });
    setShowQuestionDialog(true);
  };

  const handleEditQuestion = (quiz: QuizWithStats, question: Question) => {
    setSelectedQuiz(quiz);
    setEditingQuestion(question);
    setQuestionForm({
      question: question.question,
      options: question.options || ['', '', '', ''],
      correctAnswer: Array.isArray(question.correctAnswer) 
        ? question.correctAnswer.join(', ') 
        : question.correctAnswer,
      explanation: question.explanation || '',
      points: question.points,
      type: question.type
    });
    setShowQuestionDialog(true);
  };

  const handleDeleteQuestion = (quiz: QuizWithStats, question: Question) => {
    if (confirm('Are you sure you want to delete this question?')) {
      setQuizzes(prev => prev.map(q => 
        q.id === quiz.id 
          ? { ...q, questions: q.questions.filter(qu => qu.id !== question.id) }
          : q
      ));
    }
  };

  const handleMoveQuestion = (quiz: QuizWithStats, questionId: string, direction: 'up' | 'down') => {
    const questions = [...quiz.questions].sort((a, b) => a.order - b.order);
    const index = questions.findIndex(q => q.id === questionId);
    
    if (
      (direction === 'up' && index > 0) ||
      (direction === 'down' && index < questions.length - 1)
    ) {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      const temp = questions[index];
      questions[index] = questions[newIndex]!;
      questions[newIndex] = temp!;
      
      // Update order numbers
      questions.forEach((q, i) => {
        q.order = i + 1;
      });
      
      setQuizzes(prev => prev.map(q => 
        q.id === quiz.id ? { ...q, questions } : q
      ));
    }
  };

  const handleAIGeneration = async () => {
    setAiGenerating(true);
    try {
      // Simulate AI API call
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const aiQuestions: Question[] = [];
      
      for (let i = 0; i < aiPrompt.questionCount; i++) {
        const questionType = aiPrompt.questionTypes[i % aiPrompt.questionTypes.length];
        let question: Question;
        
        if (questionType === QuestionType.MULTIPLE_CHOICE) {
          question = {
            id: `ai-q-${i + 1}`,
            quizId: selectedQuiz?.id || 'new',
            type: QuestionType.MULTIPLE_CHOICE,
            question: `${aiPrompt.topic} question ${i + 1}: Which of the following is correct?`,
            options: [
              `Correct answer about ${aiPrompt.topic}`,
              `Incorrect option A`,
              `Incorrect option B`,
              `Incorrect option C`
            ],
            correctAnswer: `Correct answer about ${aiPrompt.topic}`,
            explanation: aiPrompt.includeExplanations 
              ? `This is correct because it demonstrates key ${aiPrompt.topic} concepts.`
              : '',
            points: 10,
            order: i + 1
          };
        } else if (questionType === QuestionType.TRUE_FALSE) {
          question = {
            id: `ai-q-${i + 1}`,
            quizId: selectedQuiz?.id || 'new',
            type: QuestionType.TRUE_FALSE,
            question: `${aiPrompt.topic} statement ${i + 1}: This is a true statement about the topic.`,
            options: ['True', 'False'],
            correctAnswer: 'True',
            explanation: aiPrompt.includeExplanations 
              ? `This statement is true based on ${aiPrompt.topic} principles.`
              : '',
            points: 5,
            order: i + 1
          };
        } else {
          question = {
            id: `ai-q-${i + 1}`,
            quizId: selectedQuiz?.id || 'new',
            type: questionType || QuestionType.SHORT_ANSWER,
            question: `Explain a key concept related to ${aiPrompt.topic}.`,
            correctAnswer: `Sample answer about ${aiPrompt.topic}`,
            explanation: aiPrompt.includeExplanations 
              ? `Look for explanations covering these key points about ${aiPrompt.topic}.`
              : '',
            points: 15,
            order: i + 1
          };
        }
        
        aiQuestions.push(question);
      }
      
      if (selectedQuiz) {
        // Add to existing quiz
        setQuizzes(prev => prev.map(q => 
          q.id === selectedQuiz.id 
            ? { ...q, questions: [...q.questions, ...aiQuestions] }
            : q
        ));
      } else {
        // Create new quiz
        const newQuiz: QuizWithStats = {
          id: `quiz-${Date.now()}`,
          moduleId: 'module-new',
          title: `AI Generated ${aiPrompt.topic} Quiz`,
          description: `AI-generated quiz covering ${aiPrompt.topic} at ${aiPrompt.difficulty} level`,
          timeLimit: Math.max(aiPrompt.questionCount * 2, 15),
          passingScore: 70,
          createdAt: new Date(),
          updatedAt: new Date(),
          questions: aiQuestions,
          attemptCount: 0,
          averageScore: 0,
          passRate: 0,
          averageTime: 0
        };
        
        setQuizzes(prev => [...prev, newQuiz]);
      }
      
      setShowAIDialog(false);
    } catch (error) {
      console.error('AI generation failed:', error);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleSaveQuestion = () => {
    if (!selectedQuiz) return;

    const question: Question = {
      id: editingQuestion?.id || `q-${Date.now()}`,
      quizId: selectedQuiz.id,
      type: questionForm.type,
      question: questionForm.question,
      options: questionForm.type === QuestionType.MULTIPLE_CHOICE || questionForm.type === QuestionType.TRUE_FALSE 
        ? questionForm.options.filter(opt => opt.trim() !== '')
        : [],
      correctAnswer: questionForm.correctAnswer,
      explanation: questionForm.explanation || '',
      points: questionForm.points,
      order: editingQuestion?.order || selectedQuiz.questions.length + 1
    };

    setQuizzes(prev => prev.map(q => {
      if (q.id === selectedQuiz.id) {
        const updatedQuestions = editingQuestion
          ? q.questions.map(qu => qu.id === editingQuestion.id ? question : qu)
          : [...q.questions, question];
        return { ...q, questions: updatedQuestions };
      }
      return q;
    }));

    setShowQuestionDialog(false);
  };

  const quizColumns = [
    {
      accessorKey: 'title',
      header: createSortableHeader('Quiz Title'),
      cell: ({ row }: { row: any }) => {
        const quiz = row.original;
        return (
          <div>
            <p className="font-medium">{quiz.title}</p>
            <p className="text-sm text-gray-500 truncate">{quiz.description}</p>
          </div>
        );
      }
    },
    {
      accessorKey: 'questions',
      header: 'Questions',
      cell: ({ row }: { row: any }) => {
        const questionCount = row.original.questions.length;
        return (
          <div className="text-center">
            <p className="font-medium">{questionCount}</p>
            <p className="text-xs text-gray-500">questions</p>
          </div>
        );
      }
    },
    {
      accessorKey: 'attemptCount',
      header: createSortableHeader('Attempts'),
      cell: ({ row }: { row: any }) => {
        const attempts = row.getValue('attemptCount') as number;
        return attempts.toLocaleString();
      }
    },
    {
      accessorKey: 'averageScore',
      header: createSortableHeader('Avg Score'),
      cell: ({ row }: { row: any }) => {
        const score = row.getValue('averageScore') as number;
        return (
          <div className="text-center">
            <p className="font-medium">{score.toFixed(1)}%</p>
          </div>
        );
      }
    },
    {
      accessorKey: 'passRate',
      header: createSortableHeader('Pass Rate'),
      cell: ({ row }: { row: any }) => {
        const passRate = row.getValue('passRate') as number;
        return (
          <Badge className={
            passRate >= 80 ? 'bg-green-100 text-green-800' :
            passRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }>
            {passRate.toFixed(1)}%
          </Badge>
        );
      }
    },
    {
      accessorKey: 'timeLimit',
      header: 'Time Limit',
      cell: ({ row }: { row: any }) => {
        const timeLimit = row.getValue('timeLimit') as number;
        return timeLimit ? `${timeLimit} min` : 'No limit';
      }
    },
    {
      accessorKey: 'updatedAt',
      header: createSortableHeader('Last Updated'),
      cell: ({ row }: { row: any }) => {
        const date = row.getValue('updatedAt') as Date;
        return formatDate(date);
      }
    },
    createActionColumn((quiz: QuizWithStats) => (
      <>
        <DropdownMenuItem onClick={() => setSelectedQuiz(quiz)}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleEditQuiz(quiz)}>
          <Edit3 className="mr-2 h-4 w-4" />
          Edit Quiz
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleAddQuestion(quiz)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Question
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => {}}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => {}}>
          <BarChart3 className="mr-2 h-4 w-4" />
          View Analytics
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleDeleteQuiz(quiz)}
          className="text-red-600"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </>
    ))
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Quiz Builder</h2>
          <p className="text-gray-600 mt-1">
            Create, manage, and analyze quizzes for your courses
          </p>
        </div>
        <div className="flex space-x-4">
          <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Brain className="h-4 w-4 mr-2" />
                AI Assistant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="flex items-center">
                  <Wand2 className="h-5 w-5 mr-2 text-purple-600" />
                  AI Quiz Generator
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Topic</label>
                  <Input
                    placeholder="e.g., React Hooks, JavaScript Arrays"
                    value={aiPrompt.topic}
                    onChange={(e) => setAiPrompt(prev => ({ ...prev, topic: e.target.value }))}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Difficulty</label>
                    <Select 
                      value={aiPrompt.difficulty} 
                      onValueChange={(value) => setAiPrompt(prev => ({ ...prev, difficulty: value as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="beginner">Beginner</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2">Questions</label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={aiPrompt.questionCount}
                      onChange={(e) => setAiPrompt(prev => ({ ...prev, questionCount: parseInt(e.target.value) || 1 }))}
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Question Types</label>
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={aiPrompt.questionTypes.includes(QuestionType.MULTIPLE_CHOICE)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAiPrompt(prev => ({ 
                              ...prev, 
                              questionTypes: [...prev.questionTypes, QuestionType.MULTIPLE_CHOICE] 
                            }));
                          } else {
                            setAiPrompt(prev => ({ 
                              ...prev, 
                              questionTypes: prev.questionTypes.filter(t => t !== QuestionType.MULTIPLE_CHOICE) 
                            }));
                          }
                        }}
                      />
                      <span className="text-sm">Multiple Choice</span>
                    </label>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={aiPrompt.questionTypes.includes(QuestionType.TRUE_FALSE)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAiPrompt(prev => ({ 
                              ...prev, 
                              questionTypes: [...prev.questionTypes, QuestionType.TRUE_FALSE] 
                            }));
                          } else {
                            setAiPrompt(prev => ({ 
                              ...prev, 
                              questionTypes: prev.questionTypes.filter(t => t !== QuestionType.TRUE_FALSE) 
                            }));
                          }
                        }}
                      />
                      <span className="text-sm">True/False</span>
                    </label>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={aiPrompt.includeExplanations}
                    onChange={(e) => setAiPrompt(prev => ({ ...prev, includeExplanations: e.target.checked }))}
                  />
                  <span className="text-sm">Include answer explanations</span>
                </div>
                
                <Button 
                  onClick={handleAIGeneration} 
                  disabled={aiGenerating || !aiPrompt.topic || aiPrompt.questionTypes.length === 0}
                  className="w-full"
                >
                  {aiGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Generating Questions...
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4 mr-2" />
                      Generate Quiz
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          
          <Button onClick={handleCreateQuiz}>
            <Plus className="h-4 w-4 mr-2" />
            Create Quiz
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Quizzes</p>
                <p className="text-3xl font-bold text-gray-900">{quizzes.length}</p>
              </div>
              <FileText className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Questions</p>
                <p className="text-3xl font-bold text-gray-900">
                  {quizzes.reduce((acc, quiz) => acc + quiz.questions.length, 0)}
                </p>
              </div>
              <HelpCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Attempts</p>
                <p className="text-3xl font-bold text-gray-900">
                  {quizzes.reduce((acc, quiz) => acc + quiz.attemptCount, 0).toLocaleString()}
                </p>
              </div>
              <Users className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Pass Rate</p>
                <p className="text-3xl font-bold text-gray-900">
                  {quizzes.length > 0 
                    ? (quizzes.reduce((acc, quiz) => acc + quiz.passRate, 0) / quizzes.length).toFixed(1)
                    : 0
                  }%
                </p>
              </div>
              <Target className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="quizzes" className="space-y-6">
        <TabsList>
          <TabsTrigger value="quizzes">All Quizzes</TabsTrigger>
          <TabsTrigger value="question-bank">Question Bank</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="quizzes" className="space-y-6">
          <DataTable
            columns={quizColumns}
            data={quizzes}
            searchKey="title"
            searchPlaceholder="Search quizzes..."
          />

          {/* Quiz Details Panel */}
          {selectedQuiz && (
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="flex items-center">
                    <FileText className="h-5 w-5 mr-2" />
                    {selectedQuiz.title}
                  </CardTitle>
                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm" onClick={() => handleAddQuestion(selectedQuiz)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Question
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleEditQuiz(selectedQuiz)}>
                      <Edit3 className="h-4 w-4 mr-2" />
                      Edit Quiz
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-sm text-gray-600">Questions</p>
                      <p className="text-2xl font-bold">{selectedQuiz.questions.length}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-sm text-gray-600">Time Limit</p>
                      <p className="text-2xl font-bold">{selectedQuiz.timeLimit || 'No'} min</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-sm text-gray-600">Pass Score</p>
                      <p className="text-2xl font-bold">{selectedQuiz.passingScore}%</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded">
                      <p className="text-sm text-gray-600">Total Points</p>
                      <p className="text-2xl font-bold">
                        {selectedQuiz.questions.reduce((acc, q) => acc + q.points, 0)}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-4">Questions</h4>
                    <div className="space-y-3">
                      {selectedQuiz.questions
                        .sort((a, b) => a.order - b.order)
                        .map((question, index) => (
                          <div key={question.id} className="border rounded-lg p-4">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-2">
                                  <Badge variant="outline">
                                    {question.type.replace('_', ' ')}
                                  </Badge>
                                  <span className="text-sm text-gray-500">
                                    {question.points} points
                                  </span>
                                </div>
                                <p className="font-medium mb-2">
                                  {index + 1}. {question.question}
                                </p>
                                {question.options && (
                                  <div className="text-sm text-gray-600 space-y-1">
                                    {question.options.map((option, optIndex) => (
                                      <div key={optIndex} className="flex items-center space-x-2">
                                        <span className={
                                          option === question.correctAnswer 
                                            ? 'text-green-600 font-medium' 
                                            : ''
                                        }>
                                          {String.fromCharCode(65 + optIndex)}. {option}
                                          {option === question.correctAnswer && ' ✓'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {question.explanation && (
                                  <div className="mt-2 p-2 bg-blue-50 rounded text-sm text-blue-700">
                                    <strong>Explanation:</strong> {question.explanation}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center space-x-1 ml-4">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleMoveQuestion(selectedQuiz, question.id, 'up')}
                                  disabled={index === 0}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleMoveQuestion(selectedQuiz, question.id, 'down')}
                                  disabled={index === selectedQuiz.questions.length - 1}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditQuestion(selectedQuiz, question)}
                                >
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteQuestion(selectedQuiz, question)}
                                  className="text-red-600"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="question-bank" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Lightbulb className="h-5 w-5 mr-2" />
                Question Bank
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {questionBank.map(question => (
                  <div key={question.id} className="border rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <Badge variant="outline">{question.category}</Badge>
                          <Badge className={
                            question.difficulty === 'Beginner' ? 'bg-green-100 text-green-800' :
                            question.difficulty === 'Intermediate' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }>
                            {question.difficulty}
                          </Badge>
                          <Badge variant="outline">
                            {question.type.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="font-medium">{question.question}</p>
                        <p className="text-sm text-gray-500 mt-1">
                          Used in {question.usageCount} quizzes
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Quiz Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {quizzes.map(quiz => (
                    <div key={quiz.id} className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium truncate">{quiz.title}</p>
                        <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${quiz.passRate}%` }}
                          />
                        </div>
                      </div>
                      <div className="ml-4 text-right">
                        <p className="text-sm font-medium">{quiz.passRate.toFixed(1)}%</p>
                        <p className="text-xs text-gray-500">{quiz.attemptCount} attempts</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Question Type Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Multiple Choice</span>
                    <span className="font-medium">65%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">True/False</span>
                    <span className="font-medium">25%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Short Answer</span>
                    <span className="font-medium">8%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Essay</span>
                    <span className="font-medium">2%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Question Dialog */}
      <Dialog open={showQuestionDialog} onOpenChange={setShowQuestionDialog}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>
              {editingQuestion ? 'Edit Question' : 'Add New Question'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Question Type</label>
                <Select 
                  value={questionForm.type} 
                  onValueChange={(value) => setQuestionForm(prev => ({ 
                    ...prev, 
                    type: value as QuestionType,
                    options: value === QuestionType.TRUE_FALSE ? ['True', 'False'] : ['', '', '', '']
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QuestionType.MULTIPLE_CHOICE}>Multiple Choice</SelectItem>
                    <SelectItem value={QuestionType.TRUE_FALSE}>True/False</SelectItem>
                    <SelectItem value={QuestionType.SHORT_ANSWER}>Short Answer</SelectItem>
                    <SelectItem value={QuestionType.ESSAY}>Essay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Points</label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={questionForm.points}
                  onChange={(e) => setQuestionForm(prev => ({ 
                    ...prev, 
                    points: parseInt(e.target.value) || 1 
                  }))}
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Question</label>
              <Textarea
                value={questionForm.question}
                onChange={(e) => setQuestionForm(prev => ({ ...prev, question: e.target.value }))}
                placeholder="Enter your question here..."
                rows={3}
              />
            </div>

            {(questionForm.type === QuestionType.MULTIPLE_CHOICE || questionForm.type === QuestionType.TRUE_FALSE) && (
              <div>
                <label className="block text-sm font-medium mb-2">Answer Options</label>
                <div className="space-y-2">
                  {questionForm.options.map((option, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <Input
                        value={option}
                        onChange={(e) => {
                          const newOptions = [...questionForm.options];
                          newOptions[index] = e.target.value;
                          setQuestionForm(prev => ({ ...prev, options: newOptions }));
                        }}
                        placeholder={`Option ${String.fromCharCode(65 + index)}`}
                        disabled={questionForm.type === QuestionType.TRUE_FALSE}
                      />
                      <input
                        type="radio"
                        name="correctAnswer"
                        checked={questionForm.correctAnswer === option}
                        onChange={() => setQuestionForm(prev => ({ ...prev, correctAnswer: option }))}
                        className="text-green-600"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(questionForm.type === QuestionType.SHORT_ANSWER || questionForm.type === QuestionType.ESSAY) && (
              <div>
                <label className="block text-sm font-medium mb-2">Correct Answer / Sample Answer</label>
                <Textarea
                  value={questionForm.correctAnswer}
                  onChange={(e) => setQuestionForm(prev => ({ ...prev, correctAnswer: e.target.value }))}
                  placeholder="Enter the correct answer or sample answer..."
                  rows={3}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">Explanation (Optional)</label>
              <Textarea
                value={questionForm.explanation}
                onChange={(e) => setQuestionForm(prev => ({ ...prev, explanation: e.target.value }))}
                placeholder="Explain why this answer is correct..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuestionDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveQuestion}
              disabled={!questionForm.question || !questionForm.correctAnswer}
            >
              <Save className="h-4 w-4 mr-2" />
              {editingQuestion ? 'Update Question' : 'Add Question'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}