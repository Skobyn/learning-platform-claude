import { elasticsearchClient } from './elasticsearchClient';
import { logger } from '../logger';
import { cacheService } from '../cacheService';

export interface SearchFilters {
  category?: string[];
  subcategory?: string[];
  skillLevel?: string[];
  duration?: {
    min?: number;
    max?: number;
  };
  price?: {
    min?: number;
    max?: number;
  };
  rating?: {
    min?: number;
  };
  instructor?: string[];
  language?: string[];
  tags?: string[];
  dateRange?: {
    from?: string;
    to?: string;
  };
}

export interface SearchOptions {
  query: string;
  filters?: SearchFilters;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  }[];
  page?: number;
  size?: number;
  userId?: string;
  sessionId?: string;
  includePersonalized?: boolean;
  fuzzyTolerance?: number;
  minScore?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string;
  skillLevel: string;
  duration: number;
  price: number;
  rating: number;
  reviewCount: number;
  enrollmentCount: number;
  instructor: {
    id: string;
    name: string;
    rating: number;
  };
  tags: string[];
  language: string;
  thumbnail?: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  _score: number;
  highlights?: {
    [field: string]: string[];
  };
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
  aggregations: {
    categories: Array<{ key: string; count: number }>;
    skillLevels: Array<{ key: string; count: number }>;
    priceRanges: Array<{ key: string; count: number; from?: number; to?: number }>;
    ratings: Array<{ key: string; count: number }>;
    languages: Array<{ key: string; count: number }>;
    instructors: Array<{ key: string; count: number }>;
  };
  suggestions?: string[];
  searchTime: number;
  personalized: boolean;
}

export interface AutocompleteResult {
  suggestions: Array<{
    text: string;
    type: 'course' | 'instructor' | 'category' | 'tag';
    count: number;
    highlight?: string;
  }>;
  popular: string[];
}

class SearchService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly POPULAR_SEARCHES_CACHE_KEY = 'popular_searches';
  private readonly MIN_QUERY_LENGTH = 2;
  private readonly MAX_RESULTS_PER_PAGE = 50;

  async search(options: SearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();
    const {
      query,
      filters = {},
      sort = [{ field: '_score', order: 'desc' }],
      page = 1,
      size = 20,
      userId,
      sessionId,
      includePersonalized = false,
      fuzzyTolerance = 2,
      minScore = 0.1
    } = options;

    // Validate inputs
    if (size > this.MAX_RESULTS_PER_PAGE) {
      throw new Error(`Maximum ${this.MAX_RESULTS_PER_PAGE} results per page allowed`);
    }

    try {
      // Build search query
      const searchQuery = this.buildSearchQuery(query, filters, fuzzyTolerance);

      // Add personalization if requested
      if (includePersonalized && userId) {
        await this.applyPersonalization(searchQuery, userId);
      }

      // Build aggregations
      const aggregations = this.buildAggregations();

      // Build sort
      const sortConfig = this.buildSort(sort, includePersonalized && userId);

      // Calculate pagination
      const from = (page - 1) * size;

      // Execute search
      const response = await elasticsearchClient.getClient().search({
        index: elasticsearchClient.indexes.courses,
        body: {
          query: searchQuery,
          aggs: aggregations,
          sort: sortConfig,
          from,
          size,
          min_score: minScore,
          highlight: {
            fields: {
              title: { number_of_fragments: 1, fragment_size: 100 },
              description: { number_of_fragments: 2, fragment_size: 150 },
              content: { number_of_fragments: 1, fragment_size: 200 }
            },
            pre_tags: ['<mark>'],
            post_tags: ['</mark>']
          },
          _source: {
            excludes: ['content'] // Exclude large content field from results
          }
        }
      });

      const searchTime = Date.now() - startTime;

      // Process results
      const results = this.processSearchResults(response.hits.hits);

      // Process aggregations
      const aggregationsResult = this.processAggregations(response.aggregations);

      // Get suggestions for low result count
      let suggestions: string[] = [];
      if (results.length < 3 && query.length >= this.MIN_QUERY_LENGTH) {
        suggestions = await this.getSuggestions(query);
      }

      // Track search analytics
      this.trackSearch({
        query,
        userId,
        sessionId,
        resultsCount: response.hits.total.value,
        responseTime: searchTime,
        filters,
        noResults: results.length === 0
      });

      const totalPages = Math.ceil(response.hits.total.value / size);

      return {
        results,
        total: response.hits.total.value,
        page,
        size,
        totalPages,
        aggregations: aggregationsResult,
        suggestions,
        searchTime,
        personalized: includePersonalized && Boolean(userId)
      };

    } catch (error) {
      logger.error('Search failed', { query, filters, error });
      throw error;
    }
  }

  async autocomplete(query: string, limit: number = 10): Promise<AutocompleteResult> {
    if (query.length < this.MIN_QUERY_LENGTH) {
      return {
        suggestions: [],
        popular: await this.getPopularSearches()
      };
    }

    const cacheKey = `autocomplete:${query}:${limit}`;
    const cached = await cacheService.get<AutocompleteResult>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Get course title suggestions
      const courseSuggestions = await this.getCourseSuggestions(query, limit);

      // Get instructor suggestions
      const instructorSuggestions = await this.getInstructorSuggestions(query, Math.floor(limit / 2));

      // Get category suggestions
      const categorySuggestions = await this.getCategorySuggestions(query, Math.floor(limit / 4));

      // Combine and rank suggestions
      const allSuggestions = [
        ...courseSuggestions,
        ...instructorSuggestions,
        ...categorySuggestions
      ].sort((a, b) => b.count - a.count);

      const result: AutocompleteResult = {
        suggestions: allSuggestions.slice(0, limit),
        popular: await this.getPopularSearches()
      };

      await cacheService.set(cacheKey, result, this.CACHE_TTL);
      return result;

    } catch (error) {
      logger.error('Autocomplete failed', { query, error });
      return {
        suggestions: [],
        popular: await this.getPopularSearches()
      };
    }
  }

  private buildSearchQuery(query: string, filters: SearchFilters, fuzzyTolerance: number): any {
    const mustClauses: any[] = [];
    const filterClauses: any[] = [];

    // Main search query
    if (query && query.trim()) {
      const searchQuery = {
        bool: {
          should: [
            // Exact phrase match (highest score)
            {
              multi_match: {
                query: query,
                fields: ['title^3', 'description^2', 'content'],
                type: 'phrase',
                boost: 5.0
              }
            },
            // Prefix match for autocomplete
            {
              multi_match: {
                query: query,
                fields: ['title.autocomplete^2', 'description'],
                type: 'phrase_prefix',
                boost: 3.0
              }
            },
            // Standard match with boosting
            {
              multi_match: {
                query: query,
                fields: [
                  'title^4',
                  'description^2',
                  'content',
                  'instructor.name^2',
                  'tags^1.5'
                ],
                type: 'best_fields',
                boost: 2.0,
                operator: 'or'
              }
            },
            // Fuzzy match for typo tolerance
            {
              multi_match: {
                query: query,
                fields: ['title.fuzzy^2', 'description', 'content'],
                fuzziness: Math.min(fuzzyTolerance, Math.floor(query.length / 4)),
                boost: 1.0
              }
            }
          ],
          minimum_should_match: 1
        }
      };

      mustClauses.push(searchQuery);
    } else {
      // If no query, match all but with lower score
      mustClauses.push({ match_all: {} });
    }

    // Apply filters
    if (filters.category && filters.category.length > 0) {
      filterClauses.push({
        terms: { category: filters.category }
      });
    }

    if (filters.subcategory && filters.subcategory.length > 0) {
      filterClauses.push({
        terms: { subcategory: filters.subcategory }
      });
    }

    if (filters.skillLevel && filters.skillLevel.length > 0) {
      filterClauses.push({
        terms: { skillLevel: filters.skillLevel }
      });
    }

    if (filters.duration) {
      const durationRange: any = {};
      if (filters.duration.min !== undefined) {
        durationRange.gte = filters.duration.min;
      }
      if (filters.duration.max !== undefined) {
        durationRange.lte = filters.duration.max;
      }
      if (Object.keys(durationRange).length > 0) {
        filterClauses.push({
          range: { duration: durationRange }
        });
      }
    }

    if (filters.price) {
      const priceRange: any = {};
      if (filters.price.min !== undefined) {
        priceRange.gte = filters.price.min;
      }
      if (filters.price.max !== undefined) {
        priceRange.lte = filters.price.max;
      }
      if (Object.keys(priceRange).length > 0) {
        filterClauses.push({
          range: { price: priceRange }
        });
      }
    }

    if (filters.rating && filters.rating.min !== undefined) {
      filterClauses.push({
        range: { rating: { gte: filters.rating.min } }
      });
    }

    if (filters.instructor && filters.instructor.length > 0) {
      filterClauses.push({
        terms: { 'instructor.id': filters.instructor }
      });
    }

    if (filters.language && filters.language.length > 0) {
      filterClauses.push({
        terms: { language: filters.language }
      });
    }

    if (filters.tags && filters.tags.length > 0) {
      filterClauses.push({
        terms: { tags: filters.tags }
      });
    }

    if (filters.dateRange) {
      const dateRange: any = {};
      if (filters.dateRange.from) {
        dateRange.gte = filters.dateRange.from;
      }
      if (filters.dateRange.to) {
        dateRange.lte = filters.dateRange.to;
      }
      if (Object.keys(dateRange).length > 0) {
        filterClauses.push({
          range: { createdAt: dateRange }
        });
      }
    }

    // Always filter for published courses
    filterClauses.push({
      term: { isPublished: true }
    });

    return {
      bool: {
        must: mustClauses,
        filter: filterClauses
      }
    };
  }

  private async applyPersonalization(searchQuery: any, userId: string): Promise<void> {
    try {
      // Get user preferences
      const userProfile = await this.getUserProfile(userId);
      if (!userProfile) return;

      // Add function score for personalization
      const personalizedQuery = {
        function_score: {
          query: searchQuery,
          functions: [
            // Boost preferred categories
            ...(userProfile.preferredCategories || []).map(category => ({
              filter: { term: { category } },
              weight: 1.5
            })),
            // Boost matching skill level
            {
              filter: { term: { skillLevel: userProfile.skillLevel } },
              weight: 1.3
            },
            // Boost based on completion rate
            {
              script_score: {
                script: {
                  source: "Math.log(2 + doc['completion_rate'].value)"
                }
              }
            },
            // Boost popular courses
            {
              script_score: {
                script: {
                  source: "Math.log(2 + doc['enrollmentCount'].value / 100)"
                }
              }
            }
          ],
          score_mode: 'sum',
          boost_mode: 'multiply'
        }
      };

      Object.assign(searchQuery, personalizedQuery);
    } catch (error) {
      logger.warn('Failed to apply personalization', { userId, error });
    }
  }

  private buildAggregations(): any {
    return {
      categories: {
        terms: {
          field: 'category',
          size: 20
        }
      },
      subcategories: {
        terms: {
          field: 'subcategory',
          size: 50
        }
      },
      skillLevels: {
        terms: {
          field: 'skillLevel',
          size: 10
        }
      },
      priceRanges: {
        range: {
          field: 'price',
          ranges: [
            { key: 'free', from: 0, to: 0.01 },
            { key: 'low', from: 0.01, to: 50 },
            { key: 'medium', from: 50, to: 200 },
            { key: 'high', from: 200 }
          ]
        }
      },
      ratings: {
        histogram: {
          field: 'rating',
          interval: 1,
          min_doc_count: 1
        }
      },
      languages: {
        terms: {
          field: 'language',
          size: 20
        }
      },
      instructors: {
        terms: {
          field: 'instructor.name.keyword',
          size: 20
        }
      }
    };
  }

  private buildSort(sort: Array<{ field: string; order: 'asc' | 'desc' }>, includePersonalized: boolean): any[] {
    const sortConfig: any[] = [];

    sort.forEach(s => {
      if (s.field === '_score') {
        sortConfig.push({ _score: { order: s.order } });
      } else if (s.field === 'popularity') {
        sortConfig.push({
          _script: {
            type: 'number',
            script: {
              source: 'doc["enrollmentCount"].value * 0.7 + doc["rating"].value * doc["reviewCount"].value * 0.3'
            },
            order: s.order
          }
        });
      } else {
        sortConfig.push({ [s.field]: { order: s.order } });
      }
    });

    // Always include _score as final sort
    if (!sort.some(s => s.field === '_score')) {
      sortConfig.push({ _score: { order: 'desc' } });
    }

    return sortConfig;
  }

  private processSearchResults(hits: any[]): SearchResult[] {
    return hits.map(hit => ({
      ...hit._source,
      _score: hit._score,
      highlights: hit.highlight || {}
    }));
  }

  private processAggregations(aggs: any): SearchResponse['aggregations'] {
    if (!aggs) {
      return {
        categories: [],
        skillLevels: [],
        priceRanges: [],
        ratings: [],
        languages: [],
        instructors: []
      };
    }

    return {
      categories: aggs.categories?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count
      })) || [],
      skillLevels: aggs.skillLevels?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count
      })) || [],
      priceRanges: aggs.priceRanges?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count,
        from: bucket.from,
        to: bucket.to
      })) || [],
      ratings: aggs.ratings?.buckets?.map((bucket: any) => ({
        key: bucket.key.toString(),
        count: bucket.doc_count
      })) || [],
      languages: aggs.languages?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count
      })) || [],
      instructors: aggs.instructors?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count
      })) || []
    };
  }

  private async getCourseSuggestions(query: string, limit: number): Promise<AutocompleteResult['suggestions']> {
    const response = await elasticsearchClient.getClient().search({
      index: elasticsearchClient.indexes.courses,
      body: {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query,
                  fields: ['title.autocomplete'],
                  type: 'phrase_prefix'
                }
              },
              { term: { isPublished: true } }
            ]
          }
        },
        _source: ['title', 'enrollmentCount'],
        size: limit
      }
    });

    return response.hits.hits.map((hit: any) => ({
      text: hit._source.title,
      type: 'course' as const,
      count: hit._source.enrollmentCount || 0,
      highlight: hit.highlight?.title?.[0]
    }));
  }

  private async getInstructorSuggestions(query: string, limit: number): Promise<AutocompleteResult['suggestions']> {
    const response = await elasticsearchClient.getClient().search({
      index: elasticsearchClient.indexes.courses,
      body: {
        query: {
          bool: {
            must: [
              {
                match: {
                  'instructor.name': {
                    query,
                    fuzziness: 1
                  }
                }
              },
              { term: { isPublished: true } }
            ]
          }
        },
        aggs: {
          instructors: {
            terms: {
              field: 'instructor.name.keyword',
              size: limit
            }
          }
        },
        size: 0
      }
    });

    return response.aggregations?.instructors?.buckets?.map((bucket: any) => ({
      text: bucket.key,
      type: 'instructor' as const,
      count: bucket.doc_count
    })) || [];
  }

  private async getCategorySuggestions(query: string, limit: number): Promise<AutocompleteResult['suggestions']> {
    const response = await elasticsearchClient.getClient().search({
      index: elasticsearchClient.indexes.courses,
      body: {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query,
                  fields: ['category', 'subcategory'],
                  fuzziness: 1
                }
              },
              { term: { isPublished: true } }
            ]
          }
        },
        aggs: {
          categories: {
            terms: {
              field: 'category',
              size: limit
            }
          }
        },
        size: 0
      }
    });

    return response.aggregations?.categories?.buckets?.map((bucket: any) => ({
      text: bucket.key,
      type: 'category' as const,
      count: bucket.doc_count
    })) || [];
  }

  private async getSuggestions(query: string): Promise<string[]> {
    try {
      const response = await elasticsearchClient.getClient().search({
        index: elasticsearchClient.indexes.courses,
        body: {
          suggest: {
            text: query,
            course_suggestion: {
              term: {
                field: 'title',
                suggest_mode: 'popular',
                size: 5
              }
            }
          }
        },
        size: 0
      });

      return response.suggest?.course_suggestion?.[0]?.options?.map((option: any) => option.text) || [];
    } catch (error) {
      logger.error('Failed to get suggestions', { query, error });
      return [];
    }
  }

  private async getUserProfile(userId: string): Promise<any> {
    try {
      const response = await elasticsearchClient.getClient().get({
        index: elasticsearchClient.indexes.users,
        id: userId
      });

      return response._source;
    } catch (error) {
      if (error.statusCode !== 404) {
        logger.error('Failed to get user profile', { userId, error });
      }
      return null;
    }
  }

  private async getPopularSearches(): Promise<string[]> {
    const cached = await cacheService.get<string[]>(this.POPULAR_SEARCHES_CACHE_KEY);
    if (cached) {
      return cached;
    }

    try {
      const response = await elasticsearchClient.getClient().search({
        index: elasticsearchClient.indexes.searchAnalytics,
        body: {
          query: {
            range: {
              timestamp: {
                gte: 'now-7d'
              }
            }
          },
          aggs: {
            popular_queries: {
              terms: {
                field: 'normalized_query',
                size: 10,
                min_doc_count: 5
              }
            }
          },
          size: 0
        }
      });

      const popularSearches = response.aggregations?.popular_queries?.buckets?.map((bucket: any) => bucket.key) || [];

      await cacheService.set(this.POPULAR_SEARCHES_CACHE_KEY, popularSearches, this.CACHE_TTL);
      return popularSearches;
    } catch (error) {
      logger.error('Failed to get popular searches', error);
      return [];
    }
  }

  private async trackSearch(data: {
    query: string;
    userId?: string;
    sessionId?: string;
    resultsCount: number;
    responseTime: number;
    filters: SearchFilters;
    noResults: boolean;
  }): Promise<void> {
    try {
      const doc = {
        query: data.query,
        normalized_query: data.query.toLowerCase().trim(),
        user_id: data.userId,
        session_id: data.sessionId,
        timestamp: new Date().toISOString(),
        results_count: data.resultsCount,
        clicked_results: [],
        filters_applied: data.filters,
        response_time: data.responseTime,
        no_results: data.noResults
      };

      await elasticsearchClient.getClient().index({
        index: elasticsearchClient.indexes.searchAnalytics,
        body: doc
      });
    } catch (error) {
      logger.error('Failed to track search', { query: data.query, error });
    }
  }

  async trackClick(query: string, resultId: string, userId?: string, sessionId?: string): Promise<void> {
    try {
      // Find the most recent search for this query/user/session
      const searchResponse = await elasticsearchClient.getClient().search({
        index: elasticsearchClient.indexes.searchAnalytics,
        body: {
          query: {
            bool: {
              must: [
                { term: { normalized_query: query.toLowerCase().trim() } },
                ...(userId ? [{ term: { user_id: userId } }] : []),
                ...(sessionId ? [{ term: { session_id: sessionId } }] : [])
              ]
            }
          },
          sort: [{ timestamp: { order: 'desc' } }],
          size: 1
        }
      });

      if (searchResponse.hits.hits.length > 0) {
        const searchDoc = searchResponse.hits.hits[0];
        const clickedResults = searchDoc._source.clicked_results || [];
        clickedResults.push(resultId);

        await elasticsearchClient.getClient().update({
          index: elasticsearchClient.indexes.searchAnalytics,
          id: searchDoc._id,
          body: {
            doc: {
              clicked_results: clickedResults
            }
          }
        });
      }
    } catch (error) {
      logger.error('Failed to track click', { query, resultId, error });
    }
  }

  async getSearchAnalytics(from: Date, to: Date): Promise<any> {
    try {
      const response = await elasticsearchClient.getClient().search({
        index: elasticsearchClient.indexes.searchAnalytics,
        body: {
          query: {
            range: {
              timestamp: {
                gte: from.toISOString(),
                lte: to.toISOString()
              }
            }
          },
          aggs: {
            total_searches: {
              value_count: {
                field: 'query'
              }
            },
            unique_queries: {
              cardinality: {
                field: 'normalized_query'
              }
            },
            no_results_rate: {
              avg: {
                field: 'no_results'
              }
            },
            avg_response_time: {
              avg: {
                field: 'response_time'
              }
            },
            popular_queries: {
              terms: {
                field: 'normalized_query',
                size: 10
              }
            },
            searches_by_hour: {
              date_histogram: {
                field: 'timestamp',
                calendar_interval: 'hour'
              }
            }
          },
          size: 0
        }
      });

      return response.aggregations;
    } catch (error) {
      logger.error('Failed to get search analytics', error);
      throw error;
    }
  }
}

export const searchService = new SearchService();