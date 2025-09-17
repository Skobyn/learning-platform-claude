import { NextRequest, NextResponse } from 'next/server';
import { quizService } from '@/services/quizService';
import { sessionUtils } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { quizId: string } }
) {
  try {
    const user = await sessionUtils.getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { quizId } = params;

    // Start quiz attempt
    const result = await quizService.startQuizAttempt(quizId, user.id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      attemptId: result.attemptId,
      quiz: result.quiz,
    });

  } catch (error) {
    console.error('Start quiz attempt API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start quiz' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { quizId: string } }
) {
  try {
    const user = await sessionUtils.getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { answers, attemptId } = body;
    const { quizId } = params;

    // Validate input
    if (!answers || !Array.isArray(answers)) {
      return NextResponse.json(
        { success: false, error: 'Answers are required' },
        { status: 400 }
      );
    }

    if (!attemptId) {
      return NextResponse.json(
        { success: false, error: 'Attempt ID is required' },
        { status: 400 }
      );
    }

    // Submit quiz attempt
    const result = await quizService.submitQuizAttempt({
      quizId: attemptId, // Note: This should be attemptId, the service method signature needs updating
      userId: user.id,
      answers,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      result: result.result,
    });

  } catch (error) {
    console.error('Submit quiz API error:', error);
    return NextResponse.json(
      { success: false, error: 'Quiz submission failed' },
      { status: 500 }
    );
  }
}