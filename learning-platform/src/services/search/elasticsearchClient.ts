import { Client } from '@elastic/elasticsearch';
import { config } from '../../config';
import { logger } from '../logger';

export interface SearchConfig {
  node: string;
  auth?: {
    username: string;
    password: string;
  };
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
  };
  requestTimeout: number;
  pingTimeout: number;
  sniffOnStart?: boolean;
  sniffInterval?: number;
  maxRetries: number;
  resurrectStrategy: 'ping' | 'optimistic' | 'none';
}

export interface IndexConfig {
  courses: string;
  lessons: string;
  resources: string;
  users: string;
  searchAnalytics: string;
}

class ElasticsearchClient {
  private client: Client;
  private isConnected: boolean = false;

  public readonly indexes: IndexConfig = {
    courses: process.env.ES_INDEX_COURSES || 'learning_platform_courses',
    lessons: process.env.ES_INDEX_LESSONS || 'learning_platform_lessons',
    resources: process.env.ES_INDEX_RESOURCES || 'learning_platform_resources',
    users: process.env.ES_INDEX_USERS || 'learning_platform_users',
    searchAnalytics: process.env.ES_INDEX_ANALYTICS || 'learning_platform_search_analytics'
  };

  constructor() {
    const searchConfig: SearchConfig = {
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      auth: process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD ? {
        username: process.env.ELASTICSEARCH_USERNAME,
        password: process.env.ELASTICSEARCH_PASSWORD
      } : undefined,
      tls: process.env.ELASTICSEARCH_CA_CERT ? {
        ca: process.env.ELASTICSEARCH_CA_CERT,
        cert: process.env.ELASTICSEARCH_CLIENT_CERT,
        key: process.env.ELASTICSEARCH_CLIENT_KEY,
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      } : undefined,
      requestTimeout: parseInt(process.env.ES_REQUEST_TIMEOUT || '30000'),
      pingTimeout: parseInt(process.env.ES_PING_TIMEOUT || '3000'),
      sniffOnStart: process.env.ES_SNIFF_ON_START === 'true',
      sniffInterval: parseInt(process.env.ES_SNIFF_INTERVAL || '300000'),
      maxRetries: parseInt(process.env.ES_MAX_RETRIES || '3'),
      resurrectStrategy: (process.env.ES_RESURRECT_STRATEGY as any) || 'ping'
    };

    this.client = new Client(searchConfig);
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Test connection
      const health = await this.client.cluster.health({
        wait_for_status: 'yellow',
        timeout: '10s'
      });

      if (health.status === 'red') {
        throw new Error('Elasticsearch cluster is in red status');
      }

      this.isConnected = true;
      logger.info('Elasticsearch client initialized successfully', {
        cluster: health.cluster_name,
        status: health.status,
        nodes: health.number_of_nodes
      });

      await this.ensureIndexes();
    } catch (error) {
      logger.error('Failed to initialize Elasticsearch client', error);
      this.isConnected = false;
      throw error;
    }
  }

  private async ensureIndexes(): Promise<void> {
    const indexConfigs = [
      {
        index: this.indexes.courses,
        mappings: await this.getCoursesMappings()
      },
      {
        index: this.indexes.lessons,
        mappings: await this.getLessonsMappings()
      },
      {
        index: this.indexes.resources,
        mappings: await this.getResourcesMappings()
      },
      {
        index: this.indexes.users,
        mappings: await this.getUsersMappings()
      },
      {
        index: this.indexes.searchAnalytics,
        mappings: await this.getAnalyticsMappings()
      }
    ];

    for (const indexConfig of indexConfigs) {
      try {
        const exists = await this.client.indices.exists({
          index: indexConfig.index
        });

        if (!exists) {
          await this.client.indices.create({
            index: indexConfig.index,
            body: {
              settings: {
                number_of_shards: parseInt(process.env.ES_SHARDS || '1'),
                number_of_replicas: parseInt(process.env.ES_REPLICAS || '1'),
                analysis: {
                  analyzer: {
                    autocomplete_search: {
                      tokenizer: 'keyword',
                      filter: ['lowercase']
                    },
                    autocomplete_index: {
                      tokenizer: 'autocomplete',
                      filter: ['lowercase']
                    },
                    fuzzy_search: {
                      tokenizer: 'standard',
                      filter: ['lowercase', 'asciifolding', 'stop']
                    }
                  },
                  tokenizer: {
                    autocomplete: {
                      type: 'edge_ngram',
                      min_gram: 2,
                      max_gram: 20,
                      token_chars: ['letter', 'digit']
                    }
                  }
                }
              },
              mappings: indexConfig.mappings
            }
          });

          logger.info(`Created Elasticsearch index: ${indexConfig.index}`);
        }
      } catch (error) {
        logger.error(`Failed to create index ${indexConfig.index}`, error);
        throw error;
      }
    }
  }

  private async getCoursesMappings(): Promise<any> {
    return {
      properties: {
        id: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'standard',
          fields: {
            autocomplete: {
              type: 'text',
              analyzer: 'autocomplete_index',
              search_analyzer: 'autocomplete_search'
            },
            fuzzy: {
              type: 'text',
              analyzer: 'fuzzy_search'
            }
          }
        },
        description: {
          type: 'text',
          analyzer: 'standard'
        },
        content: {
          type: 'text',
          analyzer: 'standard'
        },
        category: { type: 'keyword' },
        subcategory: { type: 'keyword' },
        skillLevel: { type: 'keyword' },
        duration: { type: 'integer' },
        price: { type: 'float' },
        rating: { type: 'float' },
        reviewCount: { type: 'integer' },
        enrollmentCount: { type: 'integer' },
        instructor: {
          type: 'object',
          properties: {
            id: { type: 'keyword' },
            name: {
              type: 'text',
              fields: {
                keyword: { type: 'keyword' }
              }
            },
            rating: { type: 'float' }
          }
        },
        tags: { type: 'keyword' },
        language: { type: 'keyword' },
        isPublished: { type: 'boolean' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
        popularity_score: { type: 'float' },
        completion_rate: { type: 'float' }
      }
    };
  }

  private async getLessonsMappings(): Promise<any> {
    return {
      properties: {
        id: { type: 'keyword' },
        courseId: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'standard',
          fields: {
            autocomplete: {
              type: 'text',
              analyzer: 'autocomplete_index',
              search_analyzer: 'autocomplete_search'
            }
          }
        },
        content: { type: 'text' },
        transcript: { type: 'text' },
        duration: { type: 'integer' },
        lessonType: { type: 'keyword' },
        order: { type: 'integer' },
        isPreview: { type: 'boolean' },
        attachments: {
          type: 'nested',
          properties: {
            name: { type: 'text' },
            type: { type: 'keyword' },
            url: { type: 'keyword' }
          }
        }
      }
    };
  }

  private async getResourcesMappings(): Promise<any> {
    return {
      properties: {
        id: { type: 'keyword' },
        title: {
          type: 'text',
          fields: {
            autocomplete: {
              type: 'text',
              analyzer: 'autocomplete_index',
              search_analyzer: 'autocomplete_search'
            }
          }
        },
        description: { type: 'text' },
        content: { type: 'text' },
        type: { type: 'keyword' },
        category: { type: 'keyword' },
        tags: { type: 'keyword' },
        downloadCount: { type: 'integer' },
        rating: { type: 'float' },
        fileSize: { type: 'long' },
        format: { type: 'keyword' },
        createdAt: { type: 'date' }
      }
    };
  }

  private async getUsersMappings(): Promise<any> {
    return {
      properties: {
        id: { type: 'keyword' },
        username: { type: 'keyword' },
        email: { type: 'keyword' },
        profile: {
          type: 'object',
          properties: {
            interests: { type: 'keyword' },
            skillLevel: { type: 'keyword' },
            preferredCategories: { type: 'keyword' }
          }
        },
        searchHistory: {
          type: 'nested',
          properties: {
            query: { type: 'text' },
            timestamp: { type: 'date' },
            results_clicked: { type: 'keyword' }
          }
        },
        enrolledCourses: { type: 'keyword' },
        completedCourses: { type: 'keyword' }
      }
    };
  }

  private async getAnalyticsMappings(): Promise<any> {
    return {
      properties: {
        query: { type: 'text' },
        normalized_query: { type: 'keyword' },
        user_id: { type: 'keyword' },
        session_id: { type: 'keyword' },
        timestamp: { type: 'date' },
        results_count: { type: 'integer' },
        clicked_results: { type: 'keyword' },
        filters_applied: {
          type: 'object',
          properties: {
            category: { type: 'keyword' },
            skillLevel: { type: 'keyword' },
            duration: { type: 'keyword' },
            price: { type: 'keyword' }
          }
        },
        response_time: { type: 'integer' },
        no_results: { type: 'boolean' }
      }
    };
  }

  public getClient(): Client {
    if (!this.isConnected) {
      throw new Error('Elasticsearch client is not connected');
    }
    return this.client;
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.ping();
      return response.statusCode === 200;
    } catch (error) {
      logger.error('Elasticsearch health check failed', error);
      return false;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.client.close();
      this.isConnected = false;
      logger.info('Elasticsearch client closed');
    } catch (error) {
      logger.error('Error closing Elasticsearch client', error);
    }
  }

  public async refreshIndex(index: string): Promise<void> {
    try {
      await this.client.indices.refresh({ index });
    } catch (error) {
      logger.error(`Failed to refresh index ${index}`, error);
      throw error;
    }
  }

  public async bulkIndex(operations: any[]): Promise<any> {
    try {
      const response = await this.client.bulk({
        body: operations,
        refresh: 'wait_for'
      });

      if (response.errors) {
        const erroredItems = response.items.filter((item: any) =>
          item.index?.error || item.update?.error || item.delete?.error
        );

        logger.warn('Bulk indexing had errors', {
          errorCount: erroredItems.length,
          totalItems: response.items.length,
          errors: erroredItems.slice(0, 5) // Log first 5 errors
        });
      }

      return response;
    } catch (error) {
      logger.error('Bulk indexing failed', error);
      throw error;
    }
  }
}

// Singleton instance
export const elasticsearchClient = new ElasticsearchClient();
export { ElasticsearchClient };