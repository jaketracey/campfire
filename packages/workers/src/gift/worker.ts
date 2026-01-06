/**
 * Gift Generation Worker
 *
 * BullMQ worker that processes gift generation jobs.
 * Uses the orchestrator service for both LLM content and image generation.
 */

import { Worker, Job } from 'bullmq';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { renderPromptFromDb } from '../lib/prompt-runtime.js';
import { env } from '../env.js';

export const GIFT_GENERATION_QUEUE = 'gift-generation';

export interface GiftGenerationJobData {
  giftId: string;
  userId: string;
  companionId: string;
  companionName: string;
  companionBackstory?: string;
  companionPersonality?: Record<string, number>;
  tokenCost: number;
  tier: 'low' | 'medium' | 'high';
}

export interface GiftGenerationResult {
  giftId: string;
  name: string;
  description: string;
  imageUrl: string;
  processingTimeMs: number;
}

interface GiftContent {
  name: string;
  description: string;
  visualPrompt: string;
  emotionalMeaning: string;
}

interface GiftGenerationWorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  concurrency?: number;
  orchestratorUrl?: string;
}

export class GiftGenerationWorker {
  private worker: Worker<GiftGenerationJobData, GiftGenerationResult> | null = null;
  private config: GiftGenerationWorkerConfig;
  private s3Client: S3Client;
  private region: string;
  private bucket: string;
  private orchestratorUrl: string;

  constructor(config: GiftGenerationWorkerConfig) {
    this.config = config;
    this.region = env.AWS_REGION;
    this.bucket = env.S3_BUCKET_MEDIA || env.S3_MEDIA_BUCKET;
    this.orchestratorUrl = config.orchestratorUrl || env.ORCHESTRATOR_URL;
    this.s3Client = new S3Client({ region: this.region });
  }

  async start(): Promise<void> {
    this.worker = new Worker<GiftGenerationJobData, GiftGenerationResult>(
      GIFT_GENERATION_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: this.config.concurrency || 2,
      }
    );

    this.worker.on('completed', (job, result) => {
      this.config.logger.info(
        {
          jobId: job.id,
          giftId: result.giftId,
          processingTimeMs: result.processingTimeMs,
        },
        'Gift generation job completed'
      );
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Gift generation job failed'
      );
    });

    this.config.logger.info(
      { concurrency: this.config.concurrency || 2 },
      'Gift generation worker started'
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.config.logger.info('Gift generation worker stopped');
    }
  }

  private async process(
    job: Job<GiftGenerationJobData>
  ): Promise<GiftGenerationResult> {
    const startTime = Date.now();
    const { data } = job;
    const {
      giftId,
      userId,
      companionId,
      companionName,
      companionBackstory,
      companionPersonality,
      tier,
    } = data;

    this.config.logger.info(
      { giftId, userId, companionId, companionName, tier },
      'Processing gift generation request'
    );

    try {
      // Step 1: Generate gift content via LLM
      const giftContent = await this.generateGiftContent({
        companionId,
        companionName,
        companionBackstory,
        companionPersonality,
        tier,
      });

      this.config.logger.debug(
        { giftId, name: giftContent.name },
        'Gift content generated'
      );

      // Step 2: Generate gift image via orchestrator
      const imageResult = await this.generateGiftImage(
        giftContent.visualPrompt,
        userId,
        companionId,
        giftId
      );

      this.config.logger.debug(
        { giftId, imageUrl: imageResult.imageUrl },
        'Gift image generated'
      );

      const processingTimeMs = Date.now() - startTime;

      // Step 3: Update gift in database with content and image
      await this.updateGiftComplete(giftId, giftContent, imageResult);

      // Step 4: Save to template library for reuse
      await this.saveToTemplateLibrary(giftId, companionId, giftContent, imageResult, data.tokenCost, data.tier);

      this.config.logger.info(
        {
          giftId,
          processingTimeMs,
          name: giftContent.name,
        },
        'Gift generation completed successfully'
      );

      return {
        giftId,
        name: giftContent.name,
        description: giftContent.description,
        imageUrl: imageResult.imageUrl,
        processingTimeMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.config.logger.error(
        { giftId, error: errorMessage },
        'Gift generation failed'
      );

      // Update gift status to failed
      await this.updateGiftFailed(giftId, errorMessage);

      throw error;
    }
  }

  private async generateGiftContent(context: {
    companionId: string;
    companionName: string;
    companionBackstory?: string;
    companionPersonality?: Record<string, number>;
    tier: 'low' | 'medium' | 'high';
  }): Promise<GiftContent> {
    const personalityDescription = context.companionPersonality
      ? Object.entries(context.companionPersonality)
          .map(([trait, value]) => `${trait}: ${value}/100`)
          .join(', ')
      : 'balanced personality';

    const tierDescription = {
      low: 'a simple but thoughtful small gift',
      medium: 'a meaningful and creative gift',
      high: 'an exceptional and memorable gift',
    }[context.tier];

    const { rendered: systemPrompt } = await renderPromptFromDb(this.config.db.sql, {
      key: 'workers.gift_generation_system_prompt',
      companionId: context.companionId,
      variables: {},
    });

    const { rendered: userPrompt } = await renderPromptFromDb(this.config.db.sql, {
      key: 'workers.gift_generation_user_prompt',
      companionId: context.companionId,
      variables: {
        tier_description: tierDescription,
        companion_name: context.companionName,
        companion_backstory: context.companionBackstory || 'A friendly and caring companion',
        personality_description: personalityDescription,
      },
    });

    // Call orchestrator's /complete endpoint with gift_generation routing
    const response = await fetch(`${this.orchestratorUrl}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        max_tokens: 500,
        temperature: 0.9,
        use_case: 'gift_generation',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Orchestrator /complete error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { content: string; latency_ms: number; provider: string };
    const textContent = result.content;

    if (!textContent) {
      throw new Error('No text response from LLM');
    }

    try {
      // Extract JSON from the response (handle potential markdown code blocks)
      let jsonText = textContent.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);
      }
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }

      const parsed = JSON.parse(jsonText.trim());

      return {
        name: String(parsed.name || 'A Special Gift'),
        description: String(parsed.description || 'A thoughtful gift for you'),
        visualPrompt: String(parsed.visualPrompt || 'A beautiful wrapped gift with a bow'),
        emotionalMeaning: String(parsed.emotionalMeaning || 'A token of appreciation'),
      };
    } catch (parseError) {
      const err = parseError instanceof Error ? parseError : new Error(String(parseError));
      this.config.logger.warn(
        { error: err.message, text: textContent.slice(0, 2000) },
        'Failed to parse LLM response'
      );
      throw new Error(`Gift generation returned invalid JSON: ${err.message}`);
    }
  }

  private async generateGiftImage(
    visualPrompt: string,
    userId: string,
    companionId: string,
    giftId: string
  ): Promise<{ imageUrl: string; s3Bucket: string; s3Key: string }> {
    // Call orchestrator for image generation with gift_image routing
    const response = await fetch(`${this.orchestratorUrl}/imagegen/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: visualPrompt,
        style: 'stylized',
        width: 512,
        height: 512,
        save_to_s3: false, // We'll upload ourselves for better key control
        use_case: 'gift_image',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Imagegen error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as {
      image_base64?: string;
      image_url?: string;
    };

    // Get image data
    let imageBuffer: Buffer;
    if (result.image_base64) {
      imageBuffer = Buffer.from(result.image_base64, 'base64');
    } else if (result.image_url) {
      // Fetch from URL if orchestrator returned a URL
      const imageResponse = await fetch(result.image_url);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch generated image: ${imageResponse.status}`);
      }
      imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    } else {
      throw new Error('No image data in response');
    }

    // Upload to S3
    const s3Key = `gifts/${userId}/${companionId}/${giftId}.png`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: imageBuffer,
        ContentType: 'image/png',
        CacheControl: 'max-age=31536000', // 1 year
      })
    );

    const imageUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${s3Key}`;

    return { imageUrl, s3Bucket: this.bucket, s3Key };
  }

  private async updateGiftComplete(
    giftId: string,
    content: GiftContent,
    image: { imageUrl: string; s3Bucket: string; s3Key: string }
  ): Promise<void> {
    await this.config.db.sql`
      UPDATE gifts
      SET
        name = ${content.name},
        description = ${content.description},
        visual_prompt = ${content.visualPrompt},
        emotional_meaning = ${content.emotionalMeaning},
        image_url = ${image.imageUrl},
        s3_bucket = ${image.s3Bucket},
        s3_key = ${image.s3Key},
        status = 'ready'
      WHERE id = ${giftId}
    `;
  }

  private async updateGiftFailed(giftId: string, error: string): Promise<void> {
    await this.config.db.sql`
      UPDATE gifts
      SET
        status = 'failed',
        generation_error = ${error}
      WHERE id = ${giftId}
    `;
  }

  /**
   * Save generated gift to the template library for reuse.
   * Uses content hash for deduplication - duplicate gifts are silently skipped.
   * Templates are by default only visible to the companion they were generated for.
   */
  private async saveToTemplateLibrary(
    giftId: string,
    companionId: string,
    content: GiftContent,
    image: { imageUrl: string; s3Bucket: string; s3Key: string },
    tokenCost: number,
    tier: string
  ): Promise<void> {
    try {
      // Generate content hash for deduplication
      const contentHash = this.generateContentHash(content);

      // Classify the gift category based on content
      const category = this.classifyGiftCategory(content);

      // Insert into gift_templates (ON CONFLICT DO NOTHING for deduplication)
      // Templates start as private (is_public = false), only visible to source_companion_id
      const result = await this.config.db.sql`
        INSERT INTO gift_templates (
          name, description, visual_prompt, emotional_meaning,
          image_url, s3_bucket, s3_key,
          category, token_cost, tier,
          source_gift_id, source_companion_id, is_public, content_hash
        ) VALUES (
          ${content.name},
          ${content.description},
          ${content.visualPrompt},
          ${content.emotionalMeaning},
          ${image.imageUrl},
          ${image.s3Bucket},
          ${image.s3Key},
          ${category},
          ${tokenCost},
          ${tier},
          ${giftId},
          ${companionId},
          ${false},
          ${contentHash}
        )
        ON CONFLICT (content_hash) DO NOTHING
        RETURNING id
      `;

      if (result.length > 0) {
        this.config.logger.info(
          { giftId, templateId: result[0].id, category },
          'Gift saved to template library'
        );
      } else {
        this.config.logger.debug(
          { giftId, contentHash },
          'Gift template already exists, skipped'
        );
      }
    } catch (error) {
      // Log but don't fail - template creation is non-critical
      this.config.logger.warn(
        { giftId, error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to save gift to template library'
      );
    }
  }

  /**
   * Generate a content hash for deduplication.
   * Uses normalized name + description to identify similar gifts.
   */
  private generateContentHash(content: GiftContent): string {
    const normalized = `${content.name.toLowerCase().trim()}|${content.description.toLowerCase().trim()}`;
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 64);
  }

  /**
   * Classify gift category based on content keywords.
   */
  private classifyGiftCategory(content: GiftContent): string {
    const text = `${content.name} ${content.description} ${content.emotionalMeaning}`.toLowerCase();

    if (text.match(/love|heart|romantic|passion|kiss|embrace/)) return 'romantic';
    if (text.match(/friend|companion|together|bond|connection/)) return 'friendship';
    if (text.match(/celebrate|birthday|congrat|party|festive|joy/)) return 'celebration';
    if (text.match(/comfort|peace|calm|sooth|relax|serene|tranquil/)) return 'comfort';
    if (text.match(/thank|gratitude|appreciate|grateful/)) return 'gratitude';
    if (text.match(/fun|play|laugh|joke|whimsy|silly/)) return 'playful';
    if (text.match(/magic|mystic|star|moon|dream|cosmic|ethereal/)) return 'mystical';
    if (text.match(/flower|tree|garden|nature|forest|leaf|bloom/)) return 'nature';
    if (text.match(/art|music|paint|create|craft|melody|song/)) return 'artistic';
    if (text.match(/think|consider|reflect|meaning|wisdom|deep/)) return 'thoughtful';

    return 'other';
  }
}
