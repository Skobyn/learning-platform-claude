'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, X, DollarSign, Clock, Star } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/button';

interface FilterAggregations {
  categories: Array<{ key: string; count: number }>;
  skillLevels: Array<{ key: string; count: number }>;
  priceRanges: Array<{ key: string; count: number; from?: number; to?: number }>;
  ratings: Array<{ key: string; count: number }>;
  languages: Array<{ key: string; count: number }>;
  instructors: Array<{ key: string; count: number }>;
}

interface SearchFiltersProps {
  filters: Record<string, any>;
  aggregations?: FilterAggregations;
  onChange: (filters: Record<string, any>) => void;
}

interface FilterSection {
  key: string;
  label: string;
  type: 'checkbox' | 'range' | 'rating';
  expanded?: boolean;
  showSearch?: boolean;
  maxVisible?: number;
}

const FILTER_SECTIONS: FilterSection[] = [
  {
    key: 'category',
    label: 'Category',
    type: 'checkbox',
    expanded: true,
    showSearch: true,
    maxVisible: 8
  },
  {
    key: 'skillLevel',
    label: 'Skill Level',
    type: 'checkbox',
    expanded: true
  },
  {
    key: 'price',
    label: 'Price',
    type: 'range',
    expanded: true
  },
  {
    key: 'rating',
    label: 'Rating',
    type: 'rating',
    expanded: true
  },
  {
    key: 'duration',
    label: 'Duration',
    type: 'range',
    expanded: false
  },
  {
    key: 'language',
    label: 'Language',
    type: 'checkbox',
    expanded: false,
    maxVisible: 5
  },
  {
    key: 'instructor',
    label: 'Instructor',
    type: 'checkbox',
    expanded: false,
    showSearch: true,
    maxVisible: 5
  }
];

const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  aggregations,
  onChange
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    FILTER_SECTIONS.reduce((acc, section) => {
      acc[section.key] = section.expanded ?? false;
      return acc;
    }, {} as Record<string, boolean>)
  );

  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [showMoreItems, setShowMoreItems] = useState<Record<string, boolean>>({});

  // Update filters
  const updateFilters = (key: string, value: any) => {
    const newFilters = { ...filters };

    if (value === null || value === undefined ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === 'object' && Object.keys(value).length === 0)) {
      delete newFilters[key];
    } else {
      newFilters[key] = value;
    }

    onChange(newFilters);
  };

  // Handle checkbox filter changes
  const handleCheckboxChange = (filterKey: string, option: string, checked: boolean) => {
    const currentValues = (filters[filterKey] as string[]) || [];

    let newValues;
    if (checked) {
      newValues = [...currentValues, option];
    } else {
      newValues = currentValues.filter(v => v !== option);
    }

    updateFilters(filterKey, newValues);
  };

  // Handle range filter changes
  const handleRangeChange = (filterKey: string, type: 'min' | 'max', value: string) => {
    const currentRange = filters[filterKey] || {};
    const numValue = value ? parseFloat(value) : undefined;

    const newRange = { ...currentRange };
    if (numValue !== undefined && !isNaN(numValue)) {
      newRange[type] = numValue;
    } else {
      delete newRange[type];
    }

    updateFilters(filterKey, Object.keys(newRange).length > 0 ? newRange : null);
  };

  // Handle rating filter
  const handleRatingChange = (minRating: number) => {
    const currentRating = filters.rating?.min;
    if (currentRating === minRating) {
      updateFilters('rating', null);
    } else {
      updateFilters('rating', { min: minRating });
    }
  };

  // Toggle section expansion
  const toggleSection = (sectionKey: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  // Toggle show more items
  const toggleShowMore = (sectionKey: string) => {
    setShowMoreItems(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  // Filter aggregation items based on search term
  const filterItems = (items: Array<{ key: string; count: number }>, searchTerm: string) => {
    if (!searchTerm) return items;
    return items.filter(item =>
      item.key.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  // Get visible items (with show more/less functionality)
  const getVisibleItems = (items: Array<{ key: string; count: number }>, sectionKey: string, maxVisible?: number) => {
    if (!maxVisible) return items;

    const showMore = showMoreItems[sectionKey];
    return showMore ? items : items.slice(0, maxVisible);
  };

  // Clear all filters
  const clearAllFilters = () => {
    onChange({});
  };

  // Get active filter count
  const activeFilterCount = Object.keys(filters).length;

  // Format duration range
  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h`;
    }
    return `${minutes}m`;
  };

  // Price range presets
  const PRICE_PRESETS = [
    { label: 'Free', min: 0, max: 0 },
    { label: 'Under $25', min: 0, max: 25 },
    { label: '$25 - $100', min: 25, max: 100 },
    { label: '$100 - $200', min: 100, max: 200 },
    { label: 'Over $200', min: 200, max: undefined }
  ];

  // Duration range presets (in minutes)
  const DURATION_PRESETS = [
    { label: 'Under 2 hours', min: 0, max: 120 },
    { label: '2-5 hours', min: 120, max: 300 },
    { label: '5-10 hours', min: 300, max: 600 },
    { label: '10-20 hours', min: 600, max: 1200 },
    { label: 'Over 20 hours', min: 1200, max: undefined }
  ];

  return (
    <div className="space-y-4">
      {/* Filter Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
        {activeFilterCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
            className="text-sm"
          >
            Clear All ({activeFilterCount})
          </Button>
        )}
      </div>

      {/* Active Filters */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-lg">
          <span className="text-sm font-medium text-gray-700">Active filters:</span>
          {Object.entries(filters).map(([key, value]) => {
            if (Array.isArray(value)) {
              return value.map((item, index) => (
                <Badge
                  key={`${key}-${index}`}
                  variant="secondary"
                  className="flex items-center gap-1"
                >
                  {item}
                  <button
                    onClick={() => handleCheckboxChange(key, item, false)}
                    className="hover:bg-gray-200 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ));
            } else if (typeof value === 'object' && value !== null) {
              const label = key === 'price'
                ? `$${value.min || 0} - $${value.max || '∞'}`
                : key === 'duration'
                ? `${formatDuration(value.min || 0)} - ${value.max ? formatDuration(value.max) : '∞'}`
                : key === 'rating'
                ? `${value.min}+ stars`
                : JSON.stringify(value);

              return (
                <Badge key={key} variant="secondary" className="flex items-center gap-1">
                  {label}
                  <button
                    onClick={() => updateFilters(key, null)}
                    className="hover:bg-gray-200 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            }
            return null;
          })}
        </div>
      )}

      {/* Filter Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {FILTER_SECTIONS.map((section) => {
          const isExpanded = expandedSections[section.key];
          const aggregationKey = section.key === 'instructor' ? 'instructors' :
                                section.key === 'category' ? 'categories' :
                                section.key === 'skillLevel' ? 'skillLevels' :
                                section.key === 'language' ? 'languages' :
                                section.key + 's';

          const items = aggregations?.[aggregationKey as keyof FilterAggregations] || [];
          const searchTerm = searchTerms[section.key] || '';
          const filteredItems = filterItems(items, searchTerm);
          const visibleItems = getVisibleItems(filteredItems, section.key, section.maxVisible);

          return (
            <div key={section.key} className="border border-gray-200 rounded-lg">
              {/* Section Header */}
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{section.label}</span>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
              </button>

              {/* Section Content */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  {/* Search Input */}
                  {section.showSearch && items.length > 5 && (
                    <div className="mb-3">
                      <input
                        type="text"
                        placeholder={`Search ${section.label.toLowerCase()}...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerms(prev => ({
                          ...prev,
                          [section.key]: e.target.value
                        }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  )}

                  {/* Checkbox Filters */}
                  {section.type === 'checkbox' && (
                    <div className="space-y-2">
                      {visibleItems.map((item) => {
                        const isChecked = (filters[section.key] as string[] || []).includes(item.key);
                        return (
                          <label key={item.key} className="flex items-center text-sm">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => handleCheckboxChange(section.key, item.key, e.target.checked)}
                              className="mr-2 rounded"
                            />
                            <span className="flex-1">{item.key}</span>
                            <span className="text-gray-400">({item.count})</span>
                          </label>
                        );
                      })}

                      {/* Show More/Less */}
                      {section.maxVisible && filteredItems.length > section.maxVisible && (
                        <button
                          onClick={() => toggleShowMore(section.key)}
                          className="text-sm text-blue-600 hover:text-blue-800 mt-2"
                        >
                          {showMoreItems[section.key]
                            ? `Show less`
                            : `Show ${filteredItems.length - section.maxVisible} more`
                          }
                        </button>
                      )}
                    </div>
                  )}

                  {/* Range Filters */}
                  {section.type === 'range' && (
                    <div className="space-y-3">
                      {/* Presets */}
                      {section.key === 'price' && (
                        <div className="space-y-2">
                          {PRICE_PRESETS.map((preset, index) => {
                            const isActive = filters.price?.min === preset.min &&
                                           (filters.price?.max === preset.max ||
                                            (!preset.max && !filters.price?.max));
                            return (
                              <button
                                key={index}
                                onClick={() => {
                                  if (isActive) {
                                    updateFilters('price', null);
                                  } else {
                                    updateFilters('price', {
                                      min: preset.min,
                                      ...(preset.max !== undefined ? { max: preset.max } : {})
                                    });
                                  }
                                }}
                                className={`w-full text-left px-3 py-2 text-sm rounded border ${
                                  isActive
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 hover:bg-gray-50'
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {section.key === 'duration' && (
                        <div className="space-y-2">
                          {DURATION_PRESETS.map((preset, index) => {
                            const isActive = filters.duration?.min === preset.min &&
                                           (filters.duration?.max === preset.max ||
                                            (!preset.max && !filters.duration?.max));
                            return (
                              <button
                                key={index}
                                onClick={() => {
                                  if (isActive) {
                                    updateFilters('duration', null);
                                  } else {
                                    updateFilters('duration', {
                                      min: preset.min,
                                      ...(preset.max !== undefined ? { max: preset.max } : {})
                                    });
                                  }
                                }}
                                className={`w-full text-left px-3 py-2 text-sm rounded border ${
                                  isActive
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 hover:bg-gray-50'
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Custom Range Inputs */}
                      <div className="border-t pt-3">
                        <div className="text-xs text-gray-500 mb-2">Custom Range:</div>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <input
                              type="number"
                              placeholder="Min"
                              value={filters[section.key]?.min || ''}
                              onChange={(e) => handleRangeChange(section.key, 'min', e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                          <span className="self-center text-gray-400">to</span>
                          <div className="flex-1">
                            <input
                              type="number"
                              placeholder="Max"
                              value={filters[section.key]?.max || ''}
                              onChange={(e) => handleRangeChange(section.key, 'max', e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Rating Filter */}
                  {section.type === 'rating' && (
                    <div className="space-y-2">
                      {[4.5, 4.0, 3.5, 3.0].map((rating) => {
                        const isActive = filters.rating?.min === rating;
                        return (
                          <button
                            key={rating}
                            onClick={() => handleRatingChange(rating)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded border ${
                              isActive
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center">
                              <div className="flex items-center mr-2">
                                {Array.from({ length: 5 }, (_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-4 w-4 ${
                                      i < Math.floor(rating)
                                        ? 'text-yellow-400 fill-current'
                                        : i === Math.floor(rating) && rating % 1 !== 0
                                        ? 'text-yellow-400 fill-current'
                                        : 'text-gray-300'
                                    }`}
                                  />
                                ))}
                              </div>
                              <span>{rating}+ stars</span>
                            </div>
                            <span className="text-gray-400">
                              ({aggregations?.ratings.find(r => parseFloat(r.key) >= rating)?.count || 0})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SearchFilters;