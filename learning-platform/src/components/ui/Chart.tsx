'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  RadialBarChart,
  RadialBar,
  ComposedChart,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ChartProps {
  type: 'line' | 'area' | 'bar' | 'pie' | 'scatter' | 'radial' | 'composed';
  data: any[];
  xKey?: string;
  yKey?: string | string[];
  title?: string;
  subtitle?: string;
  height?: number;
  width?: number;
  className?: string;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  formatter?: (value: any, name: string) => [string, string];
  labelFormatter?: (value: any) => string;
  customTooltip?: React.ComponentType<any>;
  animationBegin?: number;
  animationDuration?: number;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  loading?: boolean;
  error?: string;
}

const DEFAULT_COLORS = [
  '#3B82F6', // blue-500
  '#EF4444', // red-500
  '#10B981', // green-500
  '#F59E0B', // yellow-500
  '#8B5CF6', // purple-500
  '#06B6D4', // cyan-500
  '#F97316', // orange-500
  '#EC4899', // pink-500
  '#84CC16', // lime-500
  '#6366F1', // indigo-500
];

const CustomTooltip = ({ active, payload, label, formatter, labelFormatter }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        {label && (
          <p className="font-medium text-gray-900 mb-2">
            {labelFormatter ? labelFormatter(label) : label}
          </p>
        )}
        <div className="space-y-1">
          {payload.map((entry: any, index: number) => {
            const [value, name] = formatter ? formatter(entry.value, entry.name) : [entry.value, entry.name];
            return (
              <div key={index} className="flex items-center space-x-2 text-sm">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-gray-600">{name}:</span>
                <span className="font-medium text-gray-900">{value}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

const LoadingSpinner = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

const ErrorDisplay = ({ error }: { error: string }) => (
  <div className="flex items-center justify-center h-64 text-center">
    <div>
      <p className="text-red-600 font-medium mb-2">Failed to load chart</p>
      <p className="text-gray-500 text-sm">{error}</p>
    </div>
  </div>
);

export function Chart({
  type,
  data,
  xKey,
  yKey,
  title,
  subtitle,
  height = 300,
  width,
  className = '',
  colors = DEFAULT_COLORS,
  showLegend = true,
  showGrid = true,
  showTooltip = true,
  formatter,
  labelFormatter,
  customTooltip,
  animationBegin = 0,
  animationDuration = 1500,
  margin = { top: 5, right: 30, left: 20, bottom: 5 },
  loading = false,
  error
}: ChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data;
  }, [data]);

  const renderChart = () => {
    if (loading) return <LoadingSpinner />;
    if (error) return <ErrorDisplay error={error} />;
    if (!chartData.length) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No data available
        </div>
      );
    }

    const commonProps = {
      data: chartData,
      margin,
      width,
      height,
    };

    const tooltipComponent = customTooltip ? (
      <Tooltip content={customTooltip} />
    ) : showTooltip ? (
      <Tooltip 
        content={(props) => (
          <CustomTooltip 
            {...props} 
            formatter={formatter} 
            labelFormatter={labelFormatter} 
          />
        )}
      />
    ) : null;

    switch (type) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart {...commonProps}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
              <XAxis 
                dataKey={xKey} 
                stroke="#6B7280"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="#6B7280"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}`}
              />
              {tooltipComponent}
              {showLegend && <Legend />}
              {Array.isArray(yKey) ? (
                yKey.map((key, index) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={{ fill: colors[index % colors.length], strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: colors[index % colors.length], strokeWidth: 2 }}
                    animationBegin={animationBegin}
                    animationDuration={animationDuration}
                  />
                ))
              ) : (
                <Line
                  type="monotone"
                  dataKey={yKey}
                  stroke={colors[0]}
                  strokeWidth={2}
                  dot={{ fill: colors[0], strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6, stroke: colors[0], strokeWidth: 2 }}
                  animationBegin={animationBegin}
                  animationDuration={animationDuration}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart {...commonProps}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
              <XAxis dataKey={xKey} stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              {tooltipComponent}
              {showLegend && <Legend />}
              {Array.isArray(yKey) ? (
                yKey.map((key, index) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="1"
                    stroke={colors[index % colors.length]}
                    fill={colors[index % colors.length]}
                    fillOpacity={0.6}
                    animationBegin={animationBegin}
                    animationDuration={animationDuration}
                  />
                ))
              ) : (
                <Area
                  type="monotone"
                  dataKey={yKey}
                  stroke={colors[0]}
                  fill={colors[0]}
                  fillOpacity={0.6}
                  animationBegin={animationBegin}
                  animationDuration={animationDuration}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart {...commonProps}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
              <XAxis dataKey={xKey} stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              {tooltipComponent}
              {showLegend && <Legend />}
              {Array.isArray(yKey) ? (
                yKey.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={colors[index % colors.length]}
                    radius={[2, 2, 0, 0]}
                    animationBegin={animationBegin}
                    animationDuration={animationDuration}
                  />
                ))
              ) : (
                <Bar
                  dataKey={yKey}
                  fill={colors[0]}
                  radius={[2, 2, 0, 0]}
                  animationBegin={animationBegin}
                  animationDuration={animationDuration}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey={yKey || 'value'}
                animationBegin={animationBegin}
                animationDuration={animationDuration}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              {tooltipComponent}
              {showLegend && <Legend />}
            </PieChart>
          </ResponsiveContainer>
        );

      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart {...commonProps}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
              <XAxis dataKey={xKey} stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              {tooltipComponent}
              {showLegend && <Legend />}
              <Scatter
                dataKey={yKey}
                fill={colors[0]}
                animationBegin={animationBegin}
                animationDuration={animationDuration}
              />
            </ScatterChart>
          </ResponsiveContainer>
        );

      case 'radial':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadialBarChart cx="50%" cy="50%" innerRadius="10%" outerRadius="80%" data={chartData}>
              <RadialBar
                dataKey={yKey || 'value'}
                cornerRadius={4}
                fill={colors[0]}
                animationBegin={animationBegin}
                animationDuration={animationDuration}
              />
              {tooltipComponent}
              {showLegend && <Legend />}
            </RadialBarChart>
          </ResponsiveContainer>
        );

      case 'composed':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart {...commonProps}>
              {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
              <XAxis dataKey={xKey} stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
              {tooltipComponent}
              {showLegend && <Legend />}
              {Array.isArray(yKey) && yKey.map((key, index) => {
                // Alternate between bars and lines for visual variety
                if (index % 2 === 0) {
                  return (
                    <Bar
                      key={key}
                      dataKey={key}
                      fill={colors[index % colors.length]}
                      radius={[2, 2, 0, 0]}
                      animationBegin={animationBegin}
                      animationDuration={animationDuration}
                    />
                  );
                } else {
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={colors[index % colors.length]}
                      strokeWidth={2}
                      animationBegin={animationBegin}
                      animationDuration={animationDuration}
                    />
                  );
                }
              })}
            </ComposedChart>
          </ResponsiveContainer>
        );

      default:
        return <div className="text-center text-gray-500">Unsupported chart type</div>;
    }
  };

  const content = (
    <div className={className}>
      {renderChart()}
    </div>
  );

  if (title || subtitle) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              {title && <CardTitle className="text-lg">{title}</CardTitle>}
              {subtitle && <p className="text-gray-600 text-sm mt-1">{subtitle}</p>}
            </div>
            {loading && <Badge variant="outline">Loading...</Badge>}
            {error && <Badge variant="destructive">Error</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          {content}
        </CardContent>
      </Card>
    );
  }

  return content;
}

// Utility function for formatting common data types
export const chartFormatters = {
  currency: (value: number) => `$${value.toLocaleString()}`,
  percentage: (value: number) => `${value}%`,
  number: (value: number) => value.toLocaleString(),
  date: (value: string | Date) => new Date(value).toLocaleDateString(),
  time: (value: string | Date) => new Date(value).toLocaleTimeString(),
  datetime: (value: string | Date) => new Date(value).toLocaleString(),
};

// Predefined color schemes
export const chartColorSchemes = {
  default: DEFAULT_COLORS,
  blues: ['#EBF8FF', '#BEE3F8', '#90CDF4', '#63B3ED', '#4299E1', '#3182CE', '#2B77CB', '#2C5282'],
  greens: ['#F0FFF4', '#C6F6D5', '#9AE6B4', '#68D391', '#48BB78', '#38A169', '#2F855A', '#276749'],
  reds: ['#FED7D7', '#FEB2B2', '#FC8181', '#F56565', '#E53E3E', '#C53030', '#9B2C2C', '#742A2A'],
  purples: ['#FAF5FF', '#E9D8FD', '#D6BCFA', '#B794F6', '#9F7AEA', '#805AD5', '#6B46C1', '#553C9A'],
  warm: ['#FED7CC', '#FEBAA3', '#FD9E7A', '#FC8151', '#F56500', '#DD6B20', '#C05621', '#9C4221'],
  cool: ['#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0EA5E9', '#0284C7', '#0369A1', '#075985'],
};

// Utility for creating responsive chart containers
export function ResponsiveChart({ children, minHeight = 200, maxHeight = 600 }: {
  children: React.ReactNode;
  minHeight?: number;
  maxHeight?: number;
}) {
  return (
    <div 
      className="w-full" 
      style={{ minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
    >
      {children}
    </div>
  );
}