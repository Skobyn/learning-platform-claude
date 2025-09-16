'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, Filter, X, ChevronDown, Star, Clock, DollarSign } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/Badge';
import { SearchFilters } from './SearchFilters';
import { debounce } from 'lodash';

interface SearchResult {
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
  createdAt: string;
  _score: number;
  highlights?: {
    [field: string]: string[];
  };
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
  aggregations: {
    categories: Array<{ key: string; count: number }>;
    skillLevels: Array<{ key: string; count: number }>;
    priceRanges: Array<{ key: string; count: number }>;
    ratings: Array<{ key: string; count: number }>;
    languages: Array<{ key: string; count: number }>;
    instructors: Array<{ key: string; count: number }>;
  };
  suggestions?: string[];
  searchTime: number;
  personalized: boolean;
}

interface AutocompleteResult {
  suggestions: Array<{
    text: string;
    type: 'course' | 'instructor' | 'category' | 'tag';
    count: number;
    highlight?: string;
  }>;
  popular: string[];
}

const AdvancedSearch: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Search state
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autocomplete state
  const [autocomplete, setAutocomplete] = useState<AutocompleteResult | null>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);

  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>({});

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Sort state
  const [sortBy, setSortBy] = useState('relevance');
  const [sortOrder, setSortOrder] = useState('desc');

  // Settings
  const [personalizeResults, setPersonalizeResults] = useState(true);

  // Initialize filters from URL params
  useEffect(() => {
    const filters: Record<string, any> = {};

    // Parse URL parameters into filters
    searchParams.forEach((value, key) => {
      if (key === 'q' || key === 'page' || key === 'size' || key === 'sort') return;

      if (key.endsWith('Min') || key.endsWith('Max')) {
        const baseKey = key.replace(/(Min|Max)$/, '');
        if (!filters[baseKey]) filters[baseKey] = {};
        filters[baseKey][key.endsWith('Min') ? 'min' : 'max'] = parseFloat(value);
      } else if (key.includes(',')) {
        filters[key] = value.split(',');
      } else {
        filters[key] = [value];
      }
    });

    setActiveFilters(filters);
    setCurrentPage(parseInt(searchParams.get('page') || '1'));
    setPageSize(parseInt(searchParams.get('size') || '20'));
    setSortBy(searchParams.get('sort')?.split(':')[0] || 'relevance');
    setSortOrder(searchParams.get('sort')?.split(':')[1] || 'desc');
  }, [searchParams]);

  // Debounced autocomplete function
  const debouncedAutocomplete = useMemo(
    () => debounce(async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setAutocomplete(null);
        return;
      }

      setAutocompleteLoading(true);
      try {
        const response = await fetch(`/api/search/autocomplete?q=${encodeURIComponent(searchQuery)}&limit=10`);
        const data = await response.json();

        if (response.ok) {
          setAutocomplete(data);
        }
      } catch (error) {
        console.error('Autocomplete error:', error);
      } finally {
        setAutocompleteLoading(false);
      }
    }, 300),
    []
  );

  // Handle query change
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    debouncedAutocomplete(value);

    if (value.length >= 2) {
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
    }
  }, [debouncedAutocomplete]);

  // Build search URL
  const buildSearchURL = useCallback((overrides: Record<string, any> = {}) => {
    const params = new URLSearchParams();

    const searchQuery = overrides.query || query;
    if (searchQuery) params.set('q', searchQuery);

    const page = overrides.page || currentPage;
    if (page > 1) params.set('page', page.toString());

    if (pageSize !== 20) params.set('size', pageSize.toString());

    const sort = overrides.sortBy || sortBy;
    const order = overrides.sortOrder || sortOrder;
    if (sort !== 'relevance') {
      params.set('sort', `${sort}:${order}`);
    }

    if (personalizeResults) params.set('personalized', 'true');

    // Add filters
    const filters = overrides.filters || activeFilters;
    Object.entries(filters).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        params.set(key, value.join(','));
      } else if (typeof value === 'object' && value !== null) {
        if (value.min !== undefined) params.set(`${key}Min`, value.min.toString());
        if (value.max !== undefined) params.set(`${key}Max`, value.max.toString());
      }
    });

    return `/search?${params.toString()}`;
  }, [query, currentPage, pageSize, sortBy, sortOrder, personalizeResults, activeFilters]);

  // Perform search
  const performSearch = useCallback(async (overrides: Record<string, any> = {}) => {
    const searchQuery = overrides.query || query;

    if (!searchQuery.trim()) {
      setResults(null);
      return;
    }

    setLoading(true);
    setError(null);
    setShowAutocomplete(false);

    try {
      const url = buildSearchURL(overrides);
      const response = await fetch(`/api${url}`, {
        headers: {
          'x-session-id': sessionStorage.getItem('sessionId') || ''
        }
      });

      const data = await response.json();

      if (response.ok) {
        setResults(data);

        // Update URL without triggering a page reload
        const newURL = buildSearchURL(overrides);
        router.push(newURL, { scroll: false });
      } else {
        setError(data.error || 'Search failed');
      }
    } catch (error) {
      console.error('Search error:', error);
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [buildSearchURL, query, router]);

  // Handle search form submission
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    performSearch({ page: 1 });
  }, [performSearch]);

  // Handle autocomplete selection
  const handleAutocompleteSelect = useCallback((suggestion: string) => {
    setQuery(suggestion);
    setShowAutocomplete(false);
    setCurrentPage(1);
    performSearch({ query: suggestion, page: 1 });
  }, [performSearch]);

  // Handle filter changes
  const handleFilterChange = useCallback((filters: Record<string, any>) => {
    setActiveFilters(filters);
    setCurrentPage(1);
    performSearch({ filters, page: 1 });
  }, [performSearch]);

  // Handle result click
  const handleResultClick = useCallback(async (result: SearchResult, position: number) => {
    // Track click
    try {
      await fetch('/api/search/click', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          resultId: result.id,
          position
        })
      });
    } catch (error) {
      console.error('Click tracking error:', error);
    }

    // Navigate to course
    router.push(`/courses/${result.id}`);
  }, [query, router]);

  // Handle pagination
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    performSearch({ page });
  }, [performSearch]);

  // Handle sort change
  const handleSortChange = useCallback((sort: string) => {
    const [sortField, order] = sort.split(':');
    setSortBy(sortField);
    setSortOrder(order || 'desc');
    setCurrentPage(1);
    performSearch({ sortBy: sortField, sortOrder: order, page: 1 });
  }, [performSearch]);

  // Format duration
  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  // Format price
  const formatPrice = (price: number): string => {
    if (price === 0) return 'Free';
    return `$${price.toFixed(2)}`;
  };

  // Count active filters
  const activeFilterCount = Object.keys(activeFilters).length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Search Header */}
      <div className="mb-8">
        <form onSubmit={handleSearch} className="relative">
          <div className="flex gap-4">
            {/* Search Input */}
            <div className="flex-1 relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Search courses, instructors, topics..."
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoComplete="off"
                />
              </div>

              {/* Autocomplete Dropdown */}
              {showAutocomplete && autocomplete && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                  {autocompleteLoading ? (
                    <div className="p-4 text-center text-gray-500">Loading suggestions...</div>
                  ) : (
                    <>
                      {/* Suggestions */}
                      {autocomplete.suggestions.length > 0 && (
                        <div className="p-2">
                          <div className="text-xs text-gray-500 mb-2">Suggestions</div>
                          {autocomplete.suggestions.map((suggestion, index) => (
                            <button
                              key={index}
                              onClick={() => handleAutocompleteSelect(suggestion.text)}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 rounded flex items-center justify-between"
                            >
                              <div>
                                <span dangerouslySetInnerHTML={{ __html: suggestion.highlight || suggestion.text }} />
                                <Badge variant="secondary" className="ml-2 text-xs">
                                  {suggestion.type}
                                </Badge>
                              </div>
                              <span className="text-xs text-gray-400">{suggestion.count}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Popular Searches */}
                      {autocomplete.popular.length > 0 && (
                        <div className="border-t p-2">
                          <div className="text-xs text-gray-500 mb-2">Popular Searches</div>
                          {autocomplete.popular.slice(0, 3).map((popular, index) => (
                            <button
                              key={index}
                              onClick={() => handleAutocompleteSelect(popular)}
                              className="w-full text-left px-3 py-2 hover:bg-gray-50 rounded text-sm text-gray-700"
                            >
                              {popular}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Search Button */}
            <Button type="submit" disabled={loading} className="px-6">
              {loading ? 'Searching...' : 'Search'}
            </Button>

            {/* Filter Toggle */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="relative"
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </div>
        </form>

        {/* Personalization Toggle */}
        <div className="mt-4 flex items-center">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={personalizeResults}
              onChange={(e) => setPersonalizeResults(e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-600">Personalize results based on my interests</span>
          </label>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="mb-6 border border-gray-200 rounded-lg p-4">
          <SearchFilters
            filters={activeFilters}
            aggregations={results?.aggregations}
            onChange={handleFilterChange}
          />
        </div>
      )}

      {/* Results */}
      {error ? (
        <div className="text-center py-12">
          <div className="text-red-600 mb-4">{error}</div>
          <Button onClick={() => performSearch()} variant="outline">
            Try Again
          </Button>
        </div>
      ) : results ? (
        <>
          {/* Results Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <span className="text-gray-600">
                {results.total.toLocaleString()} results
                {query && ` for "${query}"`}
                <span className="text-sm text-gray-400 ml-2">
                  ({results.searchTime}ms)
                </span>
                {results.personalized && (
                  <Badge variant="secondary" className="ml-2">Personalized</Badge>
                )}
              </span>
            </div>

            {/* Sort Options */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Sort by:</span>
              <select
                value={`${sortBy}:${sortOrder}`}
                onChange={(e) => handleSortChange(e.target.value)}
                className="border border-gray-200 rounded px-3 py-1 text-sm"
              >
                <option value="relevance:desc">Relevance</option>
                <option value="popularity:desc">Popularity</option>
                <option value="rating:desc">Highest Rated</option>
                <option value="createdAt:desc">Newest</option>
                <option value="price:asc">Price: Low to High</option>
                <option value="price:desc">Price: High to Low</option>
                <option value="duration:asc">Duration: Short to Long</option>
                <option value="duration:desc">Duration: Long to Short</option>
              </select>
            </div>
          </div>

          {/* No Results */}
          {results.results.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-xl font-semibold text-gray-900 mb-2">No results found</div>
              <div className="text-gray-600 mb-6">
                Try adjusting your search terms or filters
              </div>

              {/* Suggestions */}
              {results.suggestions && results.suggestions.length > 0 && (
                <div className="mb-6">
                  <div className="text-sm text-gray-500 mb-3">Did you mean:</div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {results.suggestions.map((suggestion, index) => (
                      <button
                        key={index}
                        onClick={() => handleAutocompleteSelect(suggestion)}
                        className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm hover:bg-blue-100"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button
                onClick={() => {
                  setQuery('');
                  setActiveFilters({});
                  setResults(null);
                }}
                variant="outline"
              >
                Clear Search
              </Button>
            </div>
          ) : (
            <>
              {/* Results Grid */}
              <div className="grid gap-6 mb-8">
                {results.results.map((result, index) => (
                  <div
                    key={result.id}
                    className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
                    onClick={() => handleResultClick(result, index + 1 + (currentPage - 1) * pageSize)}
                  >
                    <div className="flex gap-4">
                      {/* Thumbnail */}
                      <div className="w-32 h-24 bg-gray-200 rounded-lg flex-shrink-0 flex items-center justify-center">
                        {result.thumbnail ? (
                          <img
                            src={result.thumbnail}
                            alt={result.title}
                            className="w-full h-full object-cover rounded-lg"
                          />
                        ) : (
                          <div className="text-gray-400">No image</div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="text-xl font-semibold text-gray-900 mb-1">
                              {result.highlights?.title ? (
                                <span dangerouslySetInnerHTML={{ __html: result.highlights.title[0] }} />
                              ) : (
                                result.title
                              )}
                            </h3>
                            <div className="text-sm text-gray-600">
                              by {result.instructor.name} • {result.category}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-gray-900">
                              {formatPrice(result.price)}
                            </div>
                            <div className="flex items-center text-sm text-gray-600">
                              <Star className="h-4 w-4 text-yellow-400 mr-1" />
                              {result.rating.toFixed(1)} ({result.reviewCount})
                            </div>
                          </div>
                        </div>

                        <p className="text-gray-700 mb-3">
                          {result.highlights?.description ? (
                            <span dangerouslySetInnerHTML={{ __html: result.highlights.description[0] }} />
                          ) : (
                            result.description.length > 200
                              ? `${result.description.slice(0, 200)}...`
                              : result.description
                          )}
                        </p>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <div className="flex items-center">
                              <Clock className="h-4 w-4 mr-1" />
                              {formatDuration(result.duration)}
                            </div>
                            <div>
                              {result.enrollmentCount.toLocaleString()} students
                            </div>
                            <Badge variant="secondary">{result.skillLevel}</Badge>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {result.tags.slice(0, 3).map((tag, tagIndex) => (
                              <Badge key={tagIndex} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                            {result.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{result.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {results.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    disabled={currentPage === 1}
                    onClick={() => handlePageChange(currentPage - 1)}
                  >
                    Previous
                  </Button>

                  {Array.from({ length: Math.min(5, results.totalPages) }, (_, i) => {
                    let pageNum;
                    if (results.totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= results.totalPages - 2) {
                      pageNum = results.totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNum}
                        variant={pageNum === currentPage ? 'default' : 'outline'}
                        onClick={() => handlePageChange(pageNum)}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}

                  <Button
                    variant="outline"
                    disabled={currentPage === results.totalPages}
                    onClick={() => handlePageChange(currentPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      ) : query ? (
        <div className="text-center py-12 text-gray-500">
          Enter a search query to find courses
        </div>
      ) : null}
    </div>
  );
};

export default AdvancedSearch;