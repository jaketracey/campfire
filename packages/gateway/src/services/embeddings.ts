/**
 * Embedding Service
 * Generates text embeddings for semantic search using OpenAI or local models.
 */

import { logger } from '../observability/logger.js';

const OPENAI_API_KEY = process.env['OPENAI_API_KEY'];
const EMBEDDING_MODEL = process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = parseInt(process.env['EMBEDDING_DIMENSIONS'] ?? '1536', 10);

export class EmbeddingService {
  private apiKey: string | undefined;
  private model: string;
  private dimensions: number;

  constructor() {
    this.apiKey = OPENAI_API_KEY;
    this.model = EMBEDDING_MODEL;
    this.dimensions = EMBEDDING_DIMENSIONS;
  }

  /**
   * Generate embedding for a text string
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured, using zero embedding');
      return new Array(this.dimensions).fill(0);
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text.slice(0, 8000), // Truncate to avoid token limits
          model: this.model,
          dimensions: this.dimensions,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };

      if (!data.data?.[0]?.embedding) {
        throw new Error('Invalid embedding response');
      }

      return data.data[0].embedding;
    } catch (error) {
      logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured, using zero embeddings');
      return texts.map(() => new Array(this.dimensions).fill(0));
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: texts.map(t => t.slice(0, 8000)),
          model: this.model,
          dimensions: this.dimensions,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort by index to maintain order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map(d => d.embedding);
    } catch (error) {
      logger.error({ error }, 'Failed to generate batch embeddings');
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get the embedding dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Check if the service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

// Singleton instance
let embeddingServiceInstance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingServiceInstance) {
    embeddingServiceInstance = new EmbeddingService();
  }
  return embeddingServiceInstance;
}
