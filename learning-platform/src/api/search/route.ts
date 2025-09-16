import { NextRequest, NextResponse } from 'next/server';
import { searchService } from '../../services/search/searchService';
import { indexingService } from '../../services/search/indexingService';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth';
import { logger } from '../../services/logger';
import { rateLimit } from '../../middleware/rateLimiter';

// Rate limiting for search endpoints
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: 'Too many search requests, please try again later.'
});

const autocompleteLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute per IP
  message: 'Too many autocomplete requests, please try again later.'
});

// Helper function to parse search filters
function parseSearchFilters(searchParams: URLSearchParams): any {
  const filters: any = {};

  // Array filters
  const arrayFilters = ['category', 'subcategory', 'skillLevel', 'instructor', 'language', 'tags'];
  arrayFilters.forEach(filter => {
    const value = searchParams.get(filter);
    if (value) {
      filters[filter] = value.split(',').map(s => s.trim()).filter(Boolean);
    }
  });

  // Range filters
  const durationMin = searchParams.get('durationMin');
  const durationMax = searchParams.get('durationMax');
  if (durationMin || durationMax) {
    filters.duration = {};
    if (durationMin) filters.duration.min = parseInt(durationMin);
    if (durationMax) filters.duration.max = parseInt(durationMax);
  }

  const priceMin = searchParams.get('priceMin');
  const priceMax = searchParams.get('priceMax');
  if (priceMin || priceMax) {
    filters.price = {};
    if (priceMin) filters.price.min = parseFloat(priceMin);
    if (priceMax) filters.price.max = parseFloat(priceMax);
  }

  const ratingMin = searchParams.get('ratingMin');
  if (ratingMin) {
    filters.rating = { min: parseFloat(ratingMin) };
  }

  // Date range
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  if (dateFrom || dateTo) {
    filters.dateRange = {};
    if (dateFrom) filters.dateRange.from = dateFrom;
    if (dateTo) filters.dateRange.to = dateTo;
  }

  return filters;
}

// Helper function to parse sort options
function parseSortOptions(searchParams: URLSearchParams): Array<{ field: string; order: 'asc' | 'desc' }> {
  const sortParam = searchParams.get('sort');
  if (!sortParam) {
    return [{ field: '_score', order: 'desc' }];
  }

  const sortOptions = sortParam.split(',').map(sort => {
    const [field, order = 'desc'] = sort.trim().split(':');
    return {
      field: field.trim(),
      order: (order.toLowerCase() === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
    };
  });

  return sortOptions.length > 0 ? sortOptions : [{ field: '_score', order: 'desc' }];
}

// GET /api/search - Main search endpoint
export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = await searchLimiter(request);
    if (rateLimitResult) return rateLimitResult;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';

    // Validate query
    if (query.length > 200) {
      return NextResponse.json(
        { error: 'Search query too long (max 200 characters)' },
        { status: 400 }
      );
    }

    // Parse parameters
    const filters = parseSearchFilters(searchParams);
    const sort = parseSortOptions(searchParams);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const size = Math.min(50, Math.max(1, parseInt(searchParams.get('size') || '20')));
    const includePersonalized = searchParams.get('personalized') === 'true';
    const fuzzyTolerance = Math.min(3, Math.max(0, parseInt(searchParams.get('fuzzy') || '2')));
    const minScore = parseFloat(searchParams.get('minScore') || '0.1');

    // Get user info if available
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    const sessionId = request.headers.get('x-session-id') || undefined;

    // Perform search
    const searchOptions = {
      query,
      filters,
      sort,
      page,
      size,
      userId,
      sessionId,
      includePersonalized,
      fuzzyTolerance,
      minScore
    };

    const results = await searchService.search(searchOptions);

    // Log search for analytics
    logger.info('Search performed', {
      query,
      userId,
      resultsCount: results.total,
      searchTime: results.searchTime,
      filters: Object.keys(filters).length > 0 ? filters : undefined
    });

    return NextResponse.json(results);

  } catch (error) {
    logger.error('Search API error', { error, url: request.url });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/search/click - Track search result clicks
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, resultId, position } = body;

    // Validate input
    if (!query || !resultId) {
      return NextResponse.json(
        { error: 'Query and resultId are required' },
        { status: 400 }
      );
    }

    // Get user info
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    const sessionId = request.headers.get('x-session-id') || undefined;

    // Track click
    await searchService.trackClick(query, resultId, userId, sessionId);

    logger.info('Search click tracked', {
      query,
      resultId,
      position,
      userId
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    logger.error('Search click tracking error', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/search/autocomplete - Autocomplete endpoint
export async function autocomplete(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = await autocompleteLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '10')));

    // Validate query
    if (query.length > 100) {
      return NextResponse.json(
        { error: 'Query too long (max 100 characters)' },
        { status: 400 }
      );
    }

    const results = await searchService.autocomplete(query, limit);

    return NextResponse.json(results);

  } catch (error) {
    logger.error('Autocomplete API error', { error, query: request.url });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/search/suggestions - Get search suggestions
export async function suggestions(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';

    if (query.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    // This would implement more sophisticated suggestion logic
    // For now, return autocomplete results
    const results = await searchService.autocomplete(query, 5);

    return NextResponse.json({
      suggestions: results.suggestions.map(s => s.text)
    });

  } catch (error) {
    logger.error('Suggestions API error', { error });
    return NextResponse.json({ suggestions: [] });
  }
}

// GET /api/search/analytics - Get search analytics (admin only)
export async function analytics(request: NextRequest) {
  try {
    // Check admin permissions
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // You would check if user is admin here
    // const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    // if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json(
        { error: 'from and to dates are required' },
        { status: 400 }
      );
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    const analytics = await searchService.getSearchAnalytics(fromDate, toDate);

    return NextResponse.json(analytics);

  } catch (error) {
    logger.error('Search analytics API error', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/search/reindex - Trigger reindexing (admin only)
export async function reindex(request: NextRequest) {
  try {
    // Check admin permissions
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // You would check if user is admin here
    // const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    // if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { type = 'all', batchSize = 100 } = body;

    logger.info('Reindexing started', { type, batchSize, userId: session.user.id });

    let results;
    switch (type) {
      case 'courses':
        results = await indexingService.indexCourses({ batchSize });
        break;
      case 'lessons':
        results = await indexingService.indexLessons({ batchSize });
        break;
      case 'resources':
        results = await indexingService.indexResources({ batchSize });
        break;
      case 'all':
        results = await indexingService.reindexAll({ batchSize });
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid reindex type. Use: courses, lessons, resources, or all' },
          { status: 400 }
        );
    }

    logger.info('Reindexing completed', { type, results });

    return NextResponse.json({
      success: true,
      type,
      results
    });

  } catch (error) {
    logger.error('Reindexing error', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/search/status - Get indexing status
export async function status(request: NextRequest) {
  try {
    // Check admin permissions
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const progress = await indexingService.getIndexingProgress();

    return NextResponse.json({
      success: true,
      progress,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Search status API error', { error });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export handlers for different HTTP methods
export { GET as default };

// You would set up routing in your Next.js app to map these functions to specific endpoints:
// - GET /api/search -> GET function
// - POST /api/search/click -> POST function
// - GET /api/search/autocomplete -> autocomplete function
// - GET /api/search/suggestions -> suggestions function
// - GET /api/search/analytics -> analytics function
// - POST /api/search/reindex -> reindex function
// - GET /api/search/status -> status function