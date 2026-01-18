/**
 * Influencer Models Repository
 * Data access for influencer_models table (LoRA training)
 */

import { sql } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import type { TransactionContext, PaginationOptions, PaginatedResult } from './types.js';
import { NotFoundError, wrapDatabaseError } from './errors.js';

/**
 * Influencer model status enum
 */
export type InfluencerModelStatus =
  | 'pending'
  | 'uploading'
  | 'training'
  | 'downloading'
  | 'ready'
  | 'failed';

/**
 * Influencer model record
 */
export interface InfluencerModel {
  id: string;
  name: string;
  trigger_word: string;
  training_steps: number;
  is_style: boolean;
  status: InfluencerModelStatus;
  status_message: string | null;
  training_images_s3_keys: string[];
  training_zip_s3_key: string | null;
  lora_s3_key: string | null;
  fal_training_job_id: string | null;
  fal_result_url: string | null;
  created_at: Date;
  updated_at: Date;
  training_started_at: Date | null;
  training_completed_at: Date | null;
}

/**
 * Insert data for creating a model
 */
export interface InfluencerModelInsert {
  name: string;
  trigger_word: string;
  training_steps?: number;
  is_style?: boolean;
}

/**
 * Update data for a model
 */
export interface InfluencerModelUpdate {
  name?: string;
  trigger_word?: string;
  training_steps?: number;
  is_style?: boolean;
  status?: InfluencerModelStatus;
  status_message?: string | null;
  training_images_s3_keys?: string[];
  training_zip_s3_key?: string | null;
  lora_s3_key?: string | null;
  fal_training_job_id?: string | null;
  fal_result_url?: string | null;
  training_started_at?: Date | null;
  training_completed_at?: Date | null;
}

/**
 * List filters
 */
export interface InfluencerModelListFilters extends PaginationOptions {
  status?: InfluencerModelStatus;
  search?: string;
}

/**
 * Stats response
 */
export interface InfluencerModelStats {
  total: number;
  ready: number;
  training: number;
  failed: number;
}

/**
 * Sample generation status enum
 */
export type InfluencerSampleStatus = 'pending' | 'generating' | 'completed' | 'failed';

/**
 * Sample generation record
 */
export interface InfluencerModelSample {
  id: string;
  model_id: string;
  prompt: string;
  negative_prompt: string | null;
  guidance_scale: number;
  lora_scale: number;
  num_inference_steps: number;
  seed: number | null;
  width: number;
  height: number;
  status: InfluencerSampleStatus;
  error_message: string | null;
  fal_request_id: string | null;
  image_s3_key: string | null;
  image_url: string | null;
  created_at: Date;
  completed_at: Date | null;
}

/**
 * Insert data for creating a sample
 */
export interface InfluencerModelSampleInsert {
  model_id: string;
  prompt: string;
  negative_prompt?: string | null;
  guidance_scale?: number;
  lora_scale?: number;
  num_inference_steps?: number;
  seed?: number | null;
  width?: number;
  height?: number;
}

/**
 * Update data for a sample
 */
export interface InfluencerModelSampleUpdate {
  status?: InfluencerSampleStatus;
  error_message?: string | null;
  fal_request_id?: string | null;
  image_s3_key?: string | null;
  image_url?: string | null;
  completed_at?: Date | null;
}

/**
 * Influencer Models Repository
 */
export class InfluencerModelsRepository {
  private getSql(tx?: TransactionContext) {
    return tx ?? sql();
  }

  // =========================================================================
  // Basic CRUD
  // =========================================================================

  /**
   * Find a model by ID
   */
  async findById(id: string, tx?: TransactionContext): Promise<InfluencerModel | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, name, trigger_word, training_steps, is_style,
        status, status_message,
        training_images_s3_keys, training_zip_s3_key, lora_s3_key,
        fal_training_job_id, fal_result_url,
        created_at, updated_at, training_started_at, training_completed_at
      FROM influencer_models
      WHERE id = ${id}
    `;
    return result[0] ? this.mapRow(result[0]) : null;
  }

  /**
   * Find a model by FAL job ID
   */
  async findByFalJobId(jobId: string, tx?: TransactionContext): Promise<InfluencerModel | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        id, name, trigger_word, training_steps, is_style,
        status, status_message,
        training_images_s3_keys, training_zip_s3_key, lora_s3_key,
        fal_training_job_id, fal_result_url,
        created_at, updated_at, training_started_at, training_completed_at
      FROM influencer_models
      WHERE fal_training_job_id = ${jobId}
    `;
    return result[0] ? this.mapRow(result[0]) : null;
  }

  /**
   * Create a new model
   */
  async create(data: InfluencerModelInsert, tx?: TransactionContext): Promise<InfluencerModel> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        INSERT INTO influencer_models (
          name,
          trigger_word,
          training_steps,
          is_style
        )
        VALUES (
          ${data.name},
          ${data.trigger_word},
          ${data.training_steps ?? 1000},
          ${data.is_style ?? false}
        )
        RETURNING
          id, name, trigger_word, training_steps, is_style,
          status, status_message,
          training_images_s3_keys, training_zip_s3_key, lora_s3_key,
          fal_training_job_id, fal_result_url,
          created_at, updated_at, training_started_at, training_completed_at
      `;
      return this.mapRow(result[0]!);
    } catch (error) {
      throw wrapDatabaseError(error, 'influencer_models.create');
    }
  }

  /**
   * Update a model
   */
  async update(id: string, data: InfluencerModelUpdate, tx?: TransactionContext): Promise<InfluencerModel> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE influencer_models
      SET
        name = COALESCE(${data.name ?? null}, name),
        trigger_word = COALESCE(${data.trigger_word ?? null}, trigger_word),
        training_steps = COALESCE(${data.training_steps ?? null}, training_steps),
        is_style = COALESCE(${data.is_style ?? null}, is_style),
        status = COALESCE(${data.status ?? null}, status),
        status_message = COALESCE(${data.status_message ?? null}, status_message),
        training_images_s3_keys = COALESCE(${data.training_images_s3_keys ?? null}, training_images_s3_keys),
        training_zip_s3_key = COALESCE(${data.training_zip_s3_key ?? null}, training_zip_s3_key),
        lora_s3_key = COALESCE(${data.lora_s3_key ?? null}, lora_s3_key),
        fal_training_job_id = COALESCE(${data.fal_training_job_id ?? null}, fal_training_job_id),
        fal_result_url = COALESCE(${data.fal_result_url ?? null}, fal_result_url),
        training_started_at = COALESCE(${data.training_started_at ?? null}, training_started_at),
        training_completed_at = COALESCE(${data.training_completed_at ?? null}, training_completed_at)
      WHERE id = ${id}
      RETURNING
        id, name, trigger_word, training_steps, is_style,
        status, status_message,
        training_images_s3_keys, training_zip_s3_key, lora_s3_key,
        fal_training_job_id, fal_result_url,
        created_at, updated_at, training_started_at, training_completed_at
    `;

    if (!result[0]) {
      throw new NotFoundError('InfluencerModel', id);
    }

    return this.mapRow(result[0]);
  }

  /**
   * Add an image S3 key to a model
   */
  async addImageKey(id: string, s3Key: string, tx?: TransactionContext): Promise<InfluencerModel> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE influencer_models
      SET training_images_s3_keys = array_append(training_images_s3_keys, ${s3Key})
      WHERE id = ${id}
      RETURNING
        id, name, trigger_word, training_steps, is_style,
        status, status_message,
        training_images_s3_keys, training_zip_s3_key, lora_s3_key,
        fal_training_job_id, fal_result_url,
        created_at, updated_at, training_started_at, training_completed_at
    `;

    if (!result[0]) {
      throw new NotFoundError('InfluencerModel', id);
    }

    return this.mapRow(result[0]);
  }

  /**
   * Remove an image S3 key from a model
   */
  async removeImageKey(id: string, s3Key: string, tx?: TransactionContext): Promise<InfluencerModel> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE influencer_models
      SET training_images_s3_keys = array_remove(training_images_s3_keys, ${s3Key})
      WHERE id = ${id}
      RETURNING
        id, name, trigger_word, training_steps, is_style,
        status, status_message,
        training_images_s3_keys, training_zip_s3_key, lora_s3_key,
        fal_training_job_id, fal_result_url,
        created_at, updated_at, training_started_at, training_completed_at
    `;

    if (!result[0]) {
      throw new NotFoundError('InfluencerModel', id);
    }

    return this.mapRow(result[0]);
  }

  /**
   * Delete a model
   */
  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    const result = await db`
      DELETE FROM influencer_models
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('InfluencerModel', id);
    }
  }

  // =========================================================================
  // List and Stats
  // =========================================================================

  /**
   * List models with filters
   */
  async list(filters: InfluencerModelListFilters, tx?: TransactionContext): Promise<PaginatedResult<InfluencerModel>> {
    const db = this.getSql(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Build dynamic conditions
    const conditions: ReturnType<typeof db>[] = [];

    if (filters.status) {
      conditions.push(db`status = ${filters.status}`);
    }

    if (filters.search) {
      conditions.push(db`(name ILIKE ${`%${filters.search}%`} OR trigger_word ILIKE ${`%${filters.search}%`})`);
    }

    // Build WHERE clause
    const whereClause = conditions.length > 0
      ? db`WHERE ${conditions.reduce((acc, cond, i) => (i === 0 ? cond : db`${acc} AND ${cond}`))}`
      : db``;

    const result = await db`
      SELECT
        id, name, trigger_word, training_steps, is_style,
        status, status_message,
        training_images_s3_keys, training_zip_s3_key, lora_s3_key,
        fal_training_job_id, fal_result_url,
        created_at, updated_at, training_started_at, training_completed_at
      FROM influencer_models
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `;

    const hasMore = result.length > limit;
    return {
      data: result.slice(0, limit).map((r) => this.mapRow(r)),
      hasMore,
      limit,
      offset,
    };
  }

  /**
   * Get stats for models
   */
  async getStats(tx?: TransactionContext): Promise<InfluencerModelStats> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'ready')::int as ready,
        COUNT(*) FILTER (WHERE status = 'training')::int as training,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed
      FROM influencer_models
    `;

    return {
      total: result[0]?.total ?? 0,
      ready: result[0]?.ready ?? 0,
      training: result[0]?.training ?? 0,
      failed: result[0]?.failed ?? 0,
    };
  }

  // =========================================================================
  // Row Mapper
  // =========================================================================

  private mapRow(row: Record<string, unknown>): InfluencerModel {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      trigger_word: row['trigger_word'] as string,
      training_steps: row['training_steps'] as number,
      is_style: row['is_style'] as boolean,
      status: row['status'] as InfluencerModelStatus,
      status_message: row['status_message'] as string | null,
      training_images_s3_keys: (row['training_images_s3_keys'] as string[]) ?? [],
      training_zip_s3_key: row['training_zip_s3_key'] as string | null,
      lora_s3_key: row['lora_s3_key'] as string | null,
      fal_training_job_id: row['fal_training_job_id'] as string | null,
      fal_result_url: row['fal_result_url'] as string | null,
      created_at: row['created_at'] as Date,
      updated_at: row['updated_at'] as Date,
      training_started_at: row['training_started_at'] as Date | null,
      training_completed_at: row['training_completed_at'] as Date | null,
    };
  }

  // =========================================================================
  // Sample Generation Methods
  // =========================================================================

  /**
   * Create a new sample
   */
  async createSample(data: InfluencerModelSampleInsert, tx?: TransactionContext): Promise<InfluencerModelSample> {
    const db = this.getSql(tx);
    try {
      const result = await db`
        INSERT INTO influencer_model_samples (
          model_id,
          prompt,
          negative_prompt,
          guidance_scale,
          lora_scale,
          num_inference_steps,
          seed,
          width,
          height
        )
        VALUES (
          ${data.model_id},
          ${data.prompt},
          ${data.negative_prompt ?? null},
          ${data.guidance_scale ?? 7.5},
          ${data.lora_scale ?? 1.0},
          ${data.num_inference_steps ?? 28},
          ${data.seed ?? null},
          ${data.width ?? 768},
          ${data.height ?? 1024}
        )
        RETURNING *
      `;
      return this.mapSampleRow(result[0]!);
    } catch (error) {
      throw wrapDatabaseError(error, 'influencer_model_samples.create');
    }
  }

  /**
   * Find a sample by ID
   */
  async findSampleById(id: string, tx?: TransactionContext): Promise<InfluencerModelSample | null> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM influencer_model_samples
      WHERE id = ${id}
    `;
    return result[0] ? this.mapSampleRow(result[0]) : null;
  }

  /**
   * Update a sample
   */
  async updateSample(id: string, data: InfluencerModelSampleUpdate, tx?: TransactionContext): Promise<InfluencerModelSample> {
    const db = this.getSql(tx);
    const result = await db`
      UPDATE influencer_model_samples
      SET
        status = COALESCE(${data.status ?? null}, status),
        error_message = COALESCE(${data.error_message ?? null}, error_message),
        fal_request_id = COALESCE(${data.fal_request_id ?? null}, fal_request_id),
        image_s3_key = COALESCE(${data.image_s3_key ?? null}, image_s3_key),
        image_url = COALESCE(${data.image_url ?? null}, image_url),
        completed_at = COALESCE(${data.completed_at ?? null}, completed_at)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result[0]) {
      throw new NotFoundError('InfluencerModelSample', id);
    }

    return this.mapSampleRow(result[0]);
  }

  /**
   * List samples for a model
   */
  async listSamples(modelId: string, limit = 50, tx?: TransactionContext): Promise<InfluencerModelSample[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM influencer_model_samples
      WHERE model_id = ${modelId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result.map((r) => this.mapSampleRow(r));
  }

  /**
   * Delete a sample
   */
  async deleteSample(id: string, tx?: TransactionContext): Promise<void> {
    const db = this.getSql(tx);
    const result = await db`
      DELETE FROM influencer_model_samples
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result[0]) {
      throw new NotFoundError('InfluencerModelSample', id);
    }
  }

  /**
   * Get pending samples that need status checks
   */
  async getPendingSamples(tx?: TransactionContext): Promise<InfluencerModelSample[]> {
    const db = this.getSql(tx);
    const result = await db`
      SELECT * FROM influencer_model_samples
      WHERE status IN ('pending', 'generating')
      ORDER BY created_at ASC
      LIMIT 100
    `;
    return result.map((r) => this.mapSampleRow(r));
  }

  private mapSampleRow(row: Record<string, unknown>): InfluencerModelSample {
    return {
      id: row['id'] as string,
      model_id: row['model_id'] as string,
      prompt: row['prompt'] as string,
      negative_prompt: row['negative_prompt'] as string | null,
      guidance_scale: row['guidance_scale'] as number,
      lora_scale: row['lora_scale'] as number,
      num_inference_steps: row['num_inference_steps'] as number,
      seed: row['seed'] as number | null,
      width: row['width'] as number,
      height: row['height'] as number,
      status: row['status'] as InfluencerSampleStatus,
      error_message: row['error_message'] as string | null,
      fal_request_id: row['fal_request_id'] as string | null,
      image_s3_key: row['image_s3_key'] as string | null,
      image_url: row['image_url'] as string | null,
      created_at: row['created_at'] as Date,
      completed_at: row['completed_at'] as Date | null,
    };
  }
}

// =========================================================================
// Singleton
// =========================================================================

let instance: InfluencerModelsRepository | null = null;

export function getInfluencerModelsRepository(): InfluencerModelsRepository {
  if (!instance) {
    instance = new InfluencerModelsRepository();
  }
  return instance;
}
