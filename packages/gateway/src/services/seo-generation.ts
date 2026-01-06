/**
 * SEO Generation Service
 * Generates AI-powered SEO content for companion profile pages.
 */

import { logger } from '../observability/logger.js';
import { getSeoPagesRepository } from '../repositories/seo-pages.js';
import type { CompanionWithAvatar } from '../repositories/companions.js';
import type { SeoPageContentJson } from '../db/types.js';
import { env } from '../env.js';

// Orchestrator configuration
const ORCHESTRATOR_URL = env.ORCHESTRATOR_URL;

/**
 * Orchestrator response for SEO content generation
 */
interface OrchestratorSeoResponse {
  success: boolean;
  data?: {
    title: string;
    meta_description: string;
    headline: string;
    tagline: string;
    personality_summary: string;
    key_traits: string[];
    conversation_starters: string[];
    content_html: string;
  };
  error?: string;
}

/**
 * Generate SEO content for a companion profile page
 * This function is designed to run in the background (fire-and-forget)
 */
export async function generateSeoContent(
  pageId: string,
  companion: CompanionWithAvatar
): Promise<void> {
  const seoPagesRepo = getSeoPagesRepository();
  const startTime = Date.now();

  logger.info({ pageId, companionId: companion.id }, 'Starting SEO content generation');

  try {
    // Try orchestrator first
    const orchestratorResult = await callOrchestrator(companion);

    if (orchestratorResult.success && orchestratorResult.data) {
      const data = orchestratorResult.data;

      await seoPagesRepo.setGenerationComplete(pageId, {
        title: data.title,
        meta_description: data.meta_description,
        content_html: data.content_html,
        content_json: {
          headline: data.headline,
          tagline: data.tagline,
          personalitySummary: data.personality_summary,
          keyTraits: data.key_traits,
          conversationStarters: data.conversation_starters,
        },
        generated_by_model: 'orchestrator',
      });

      const duration = Date.now() - startTime;
      logger.info({ pageId, duration }, 'SEO content generation completed via orchestrator');
      return;
    }

    // Fallback to template-based generation if orchestrator fails
    logger.warn(
      { pageId, error: orchestratorResult.error },
      'Orchestrator failed, using template-based generation'
    );

    const templateContent = generateTemplateContent(companion);

    await seoPagesRepo.setGenerationComplete(pageId, {
      title: templateContent.title,
      meta_description: templateContent.meta_description,
      content_html: templateContent.content_html,
      content_json: templateContent.content_json,
      generated_by_model: 'template-fallback',
    });

    const duration = Date.now() - startTime;
    logger.info({ pageId, duration }, 'SEO content generation completed via template');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error, pageId }, 'SEO content generation failed');

    await seoPagesRepo.setGenerationError(pageId, errorMessage);
  }
}

/**
 * Call the orchestrator to generate SEO content
 */
async function callOrchestrator(
  companion: CompanionWithAvatar
): Promise<OrchestratorSeoResponse> {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/seo/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        companion_id: companion.id,
        companion_name: companion.name,
        companion_spec: companion.spec,
        avatar_url: companion.activeAvatar?.asset_url ?? null,
      }),
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Orchestrator returned ${response.status}: ${errorText}`,
      };
    }

    const json = await response.json() as { data?: OrchestratorSeoResponse['data'] } & OrchestratorSeoResponse['data'];
    const data = json.data ?? json;
    return {
      success: true,
      data: data as OrchestratorSeoResponse['data'],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Orchestrator call failed: ${errorMessage}`,
    };
  }
}

/**
 * Generate template-based SEO content as a fallback
 */
function generateTemplateContent(companion: CompanionWithAvatar): {
  title: string;
  meta_description: string;
  content_html: string;
  content_json: SeoPageContentJson;
} {
  const name = companion.name;
  const spec = companion.spec;

  // Extract key traits from personality.traits
  const keyTraits: string[] = [];
  if (spec.personality?.traits) {
    const traits = spec.personality.traits;
    if (traits['warmth'] && traits['warmth'] > 0.6) keyTraits.push('Warm & Caring');
    if (traits['playfulness'] && traits['playfulness'] > 0.6) keyTraits.push('Playful');
    if (traits['directness'] && traits['directness'] > 0.6) keyTraits.push('Direct');
    if (traits['curiosity'] && traits['curiosity'] > 0.6) keyTraits.push('Curious');
    if (traits['empathy'] && traits['empathy'] > 0.6) keyTraits.push('Empathetic');
    if (traits['assertiveness'] && traits['assertiveness'] > 0.6) keyTraits.push('Confident');
  }

  // Fallback traits if none found
  if (keyTraits.length === 0) {
    keyTraits.push('Engaging', 'Thoughtful', 'Understanding');
  }

  const tagline = `Your personalized AI companion`;
  const personalitySummary =
    `${name} is a unique AI companion designed to engage in meaningful conversations and provide thoughtful companionship.`;

  const conversationStarters = [
    `Hi! I'm ${name}. What's on your mind today?`,
    `Tell me about something that made you smile recently.`,
    `I'd love to hear about your interests and passions.`,
  ];

  const title = `Meet ${name} - Your AI Companion | Ignite`;
  const meta_description = `Chat with ${name}, ${tagline.toLowerCase()}. ${keyTraits.slice(0, 3).join(', ')} AI companion ready to connect with you.`;

  // content_html is empty for template generation because the frontend
  // renders all structured content from contentJson (headline, tagline,
  // personalitySummary, keyTraits, conversationStarters).
  // content_html is only used for additional custom body content.
  const content_html = '';

  return {
    title,
    meta_description,
    content_html,
    content_json: {
      headline: `Meet ${name}`,
      tagline,
      personalitySummary,
      keyTraits,
      conversationStarters,
    },
  };
}
