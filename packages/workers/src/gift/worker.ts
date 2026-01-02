/**
 * Gift Generation Worker
 *
 * BullMQ worker that processes gift generation jobs.
 * Uses Anthropic to generate gift content and orchestrator for image generation.
 */

import { Worker, Job } from 'bullmq';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Anthropic from '@anthropic-ai/sdk';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';

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
  private anthropic: Anthropic;
  private region: string;
  private bucket: string;
  private orchestratorUrl: string;

  constructor(config: GiftGenerationWorkerConfig) {
    this.config = config;
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.bucket = process.env.S3_BUCKET_MEDIA || 'campfire-media';
    this.orchestratorUrl = config.orchestratorUrl || process.env.ORCHESTRATOR_URL || 'http://localhost:8000';
    this.s3Client = new S3Client({ region: this.region });
    this.anthropic = new Anthropic();
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

    const systemPrompt = `You are a creative gift designer for AI companions. Generate unique, creative gifts that would be meaningful to give to an AI companion.

The gifts should:
- Be varied in type: objects, experiences, abstract concepts, symbolic items, artistic creations, or whimsical ideas
- Feel personal and thoughtful based on the companion's personality
- Have emotional significance and meaning
- Be visually describable for image generation

Output ONLY valid JSON with these exact fields:
{
  "name": "Short gift name (2-5 words)",
  "description": "A vivid 1-2 sentence description of the gift",
  "visualPrompt": "Detailed visual description for image generation (50-100 words). Describe the gift as a beautiful artistic still life with soft lighting, include colors, textures, atmosphere.",
  "emotionalMeaning": "A brief explanation of why this gift is meaningful (1-2 sentences)"
}`;

    const userPrompt = `Create ${tierDescription} for ${context.companionName}.

Companion's backstory: ${context.companionBackstory || 'A friendly and caring companion'}

Personality traits: ${personalityDescription}

Generate a unique and creative gift idea.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      system: systemPrompt,
    });

    const textContent = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
    if (!textContent) {
      throw new Error('No text response from LLM');
    }

    try {
      // Extract JSON from the response (handle potential markdown code blocks)
      let jsonText = textContent.text.trim();
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
      this.config.logger.warn(
        { error: parseError, text: textContent.text },
        'Failed to parse LLM response, using defaults'
      );

      // Return sensible defaults if parsing fails
      return {
        name: 'A Thoughtful Gift',
        description: `A special gift created just for ${context.companionName}`,
        visualPrompt: 'A beautifully wrapped gift box with elegant ribbon, soft warm lighting, artistic still life photography, gentle shadows, warm color palette',
        emotionalMeaning: 'A heartfelt token of appreciation and care',
      };
    }
  }

  private async generateGiftImage(
    visualPrompt: string,
    userId: string,
    companionId: string,
    giftId: string
  ): Promise<{ imageUrl: string; s3Bucket: string; s3Key: string }> {
    // Call orchestrator for image generation
    const response = await fetch(`${this.orchestratorUrl}/imagegen/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: visualPrompt,
        style: 'stylized',
        width: 512,
        height: 512,
        save_to_s3: false, // We'll upload ourselves for better key control
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
}
