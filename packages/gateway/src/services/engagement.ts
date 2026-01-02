/**
 * Engagement Scoring Service
 * Analyzes user messages to compute engagement scores for conversion optimization.
 */

import { logger } from '../observability/logger.js';
import type {
  EngagementAnalysis,
  EngagementConfig,
  ConversionDecision,
  EngagementLevel,
  EngagementSignal,
} from '../db/types.js';

// ============================================================================
// Constants - Keyword Lists
// ============================================================================

const PERSONAL_PRONOUNS = new Set([
  'i',
  'me',
  'my',
  'mine',
  'myself',
  'we',
  'us',
  'our',
  'ours',
  'ourselves',
]);

const VULNERABILITY_KEYWORDS = new Set([
  'feel',
  'feeling',
  'felt',
  'scared',
  'worried',
  'anxious',
  'nervous',
  'lonely',
  'honestly',
  'truthfully',
  'struggle',
  'struggling',
  'hard for me',
  'difficult for me',
  'need',
  'needed',
  'wish',
  'hope',
  'afraid',
  'hurt',
  'hurting',
  'sad',
  'sadness',
  'depression',
  'depressed',
  'miss',
  'missing',
  'lost',
  'confused',
  'overwhelmed',
  'stressed',
  'stress',
  'trust',
  'trusting',
  'open up',
  'opening up',
  'vulnerable',
  'vulnerability',
]);

const POSITIVE_EMOTIONAL_WORDS = new Set([
  'love',
  'loved',
  'loving',
  'happy',
  'happiness',
  'excited',
  'exciting',
  'amazing',
  'wonderful',
  'fantastic',
  'grateful',
  'thankful',
  'appreciate',
  'appreciated',
  'blessed',
  'joy',
  'joyful',
  'awesome',
  'incredible',
  'beautiful',
  'perfect',
  'great',
  'best',
  'favorite',
  'adore',
]);

const NEGATIVE_EMOTIONAL_WORDS = new Set([
  'hate',
  'hated',
  'terrible',
  'awful',
  'horrible',
  'angry',
  'anger',
  'frustrated',
  'frustrating',
  'annoyed',
  'annoying',
  'upset',
  'disappointed',
  'disappointing',
  'worst',
  'bad',
  'sucks',
  'stupid',
  'dumb',
  'unfair',
]);

const INTENSIFIERS = new Set([
  'really',
  'very',
  'so',
  'extremely',
  'incredibly',
  'absolutely',
  'totally',
  'completely',
  'omg',
  'wow',
  'damn',
  'gosh',
  'honestly',
  'literally',
  'actually',
]);

// ============================================================================
// Weight Constants
// ============================================================================

// Emotional depth weights (total = 100%)
const WEIGHT_SENTIMENT = 0.25;
const WEIGHT_PRONOUNS = 0.25;
const WEIGHT_VULNERABILITY = 0.30;
const WEIGHT_EMOTIONAL_LANGUAGE = 0.20;

// Investment weights (total = 100%)
const WEIGHT_MESSAGE_LENGTH = 0.20;
const WEIGHT_QUESTIONS = 0.30;
const WEIGHT_TOPIC_DEPTH = 0.25;
const WEIGHT_RESPONSE_TIME = 0.25;

// Cumulative score decay factor (recent messages weighted more)
const DECAY_FACTOR = 0.8;

// ============================================================================
// Service
// ============================================================================

export class EngagementService {
  /**
   * Analyze a single message and return engagement signals
   */
  analyzeMessage(
    content: string,
    previousMessages: string[],
    responseTimeMs: number | null
  ): EngagementAnalysis {
    const normalizedContent = content.toLowerCase();
    const words = this.tokenize(normalizedContent);
    const wordCount = words.length;
    const messageLength = content.length;

    // Calculate individual signal scores
    const sentimentScore = this.calculateSentimentScore(words);
    const personalPronounDensity = this.calculatePronounDensity(words);
    const vulnerabilityScore = this.calculateVulnerabilityScore(words, normalizedContent);
    const emotionalLanguageScore = this.calculateEmotionalLanguageScore(words);

    const messageLengthScore = this.calculateMessageLengthScore(messageLength);
    const questionEngagementScore = this.calculateQuestionScore(content);
    const topicDepthScore = this.calculateTopicDepthScore(words, previousMessages);
    const responseTimeScore = this.calculateResponseTimeScore(responseTimeMs);

    // Calculate composite scores
    const emotionalDepthScore = Math.round(
      sentimentScore * WEIGHT_SENTIMENT +
        personalPronounDensity * WEIGHT_PRONOUNS +
        vulnerabilityScore * WEIGHT_VULNERABILITY +
        emotionalLanguageScore * WEIGHT_EMOTIONAL_LANGUAGE
    );

    const investmentScore = Math.round(
      messageLengthScore * WEIGHT_MESSAGE_LENGTH +
        questionEngagementScore * WEIGHT_QUESTIONS +
        topicDepthScore * WEIGHT_TOPIC_DEPTH +
        responseTimeScore * WEIGHT_RESPONSE_TIME
    );

    const combinedScore = Math.round((emotionalDepthScore + investmentScore) / 2);

    const questionCount = (content.match(/\?/g) || []).length;

    return {
      sentimentScore,
      personalPronounDensity,
      vulnerabilityScore,
      emotionalLanguageScore,
      messageLengthScore,
      questionEngagementScore,
      topicDepthScore,
      responseTimeScore,
      emotionalDepthScore,
      investmentScore,
      combinedScore,
      messageLength,
      wordCount,
      questionCount,
      responseTimeMs,
    };
  }

  /**
   * Compute cumulative engagement score from all signals
   * Uses exponential decay to weight recent messages more heavily
   */
  computeCumulativeScore(signals: Array<Pick<EngagementSignal, 'combined_score'>>): number {
    if (signals.length === 0) return 0;

    // Apply exponential decay: most recent messages weighted higher
    let totalWeight = 0;
    let weightedSum = 0;

    for (let i = 0; i < signals.length; i++) {
      // Weight increases for more recent messages (higher index)
      const weight = Math.pow(DECAY_FACTOR, signals.length - 1 - i);
      weightedSum += signals[i].combined_score * weight;
      totalWeight += weight;
    }

    return Math.round(weightedSum / totalWeight);
  }

  /**
   * Determine if conversion should be triggered
   */
  shouldTriggerConversion(
    messageNumber: number,
    cumulativeScore: number,
    config: EngagementConfig
  ): ConversionDecision {
    // Always allow warm-up period (before min messages)
    if (messageNumber < config.minMessages) {
      return {
        shouldTrigger: false,
        reason: 'none',
        messageNumber,
        cumulativeScore,
        threshold: config.conversionThreshold,
      };
    }

    // Force conversion at max messages
    if (messageNumber >= config.maxMessages) {
      return {
        shouldTrigger: true,
        reason: 'max_messages',
        messageNumber,
        cumulativeScore,
        threshold: config.conversionThreshold,
      };
    }

    // Trigger if engagement threshold met
    if (cumulativeScore >= config.conversionThreshold) {
      return {
        shouldTrigger: true,
        reason: 'engagement_threshold',
        messageNumber,
        cumulativeScore,
        threshold: config.conversionThreshold,
      };
    }

    return {
      shouldTrigger: false,
      reason: 'none',
      messageNumber,
      cumulativeScore,
      threshold: config.conversionThreshold,
    };
  }

  /**
   * Determine engagement level for orchestrator guidance
   */
  getEngagementLevel(cumulativeScore: number): EngagementLevel {
    if (cumulativeScore < 30) return 'low';
    if (cumulativeScore < 60) return 'medium';
    return 'high';
  }

  // ===========================================================================
  // Private Scoring Methods
  // ===========================================================================

  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * Calculate sentiment score (0-100)
   * Based on presence of emotional words
   */
  private calculateSentimentScore(words: string[]): number {
    if (words.length === 0) return 0;

    let emotionCount = 0;
    for (const word of words) {
      if (POSITIVE_EMOTIONAL_WORDS.has(word) || NEGATIVE_EMOTIONAL_WORDS.has(word)) {
        emotionCount++;
      }
    }

    // Normalize: 0 emotional words = 0, 3+ = 100
    const ratio = emotionCount / Math.max(words.length, 1);
    return Math.min(100, Math.round(ratio * 500)); // Scale up for impact
  }

  /**
   * Calculate personal pronoun density (0-100)
   * Higher usage of I/me/my indicates personal investment
   */
  private calculatePronounDensity(words: string[]): number {
    if (words.length === 0) return 0;

    let pronounCount = 0;
    for (const word of words) {
      if (PERSONAL_PRONOUNS.has(word)) {
        pronounCount++;
      }
    }

    // Normalize: 5% pronoun density = 50 score, 10%+ = 100
    const density = pronounCount / words.length;
    return Math.min(100, Math.round(density * 1000));
  }

  /**
   * Calculate vulnerability score (0-100)
   * Presence of words indicating emotional sharing
   */
  private calculateVulnerabilityScore(words: string[], fullText: string): number {
    let score = 0;

    // Check individual words
    for (const word of words) {
      if (VULNERABILITY_KEYWORDS.has(word)) {
        score += 20;
      }
    }

    // Check phrases
    const vulnerablePhrases = [
      'hard for me',
      'difficult for me',
      'open up',
      'opening up',
      'to be honest',
      'if i\'m honest',
      'i\'ve never told',
      'first time',
    ];
    for (const phrase of vulnerablePhrases) {
      if (fullText.includes(phrase)) {
        score += 25;
      }
    }

    return Math.min(100, score);
  }

  /**
   * Calculate emotional language score (0-100)
   * Intensifiers and expressive language
   */
  private calculateEmotionalLanguageScore(words: string[]): number {
    if (words.length === 0) return 0;

    let intensifierCount = 0;
    let emotionalCount = 0;

    for (const word of words) {
      if (INTENSIFIERS.has(word)) {
        intensifierCount++;
      }
      if (POSITIVE_EMOTIONAL_WORDS.has(word) || NEGATIVE_EMOTIONAL_WORDS.has(word)) {
        emotionalCount++;
      }
    }

    // Combination of intensifiers and emotional words
    const score = (intensifierCount * 15) + (emotionalCount * 20);
    return Math.min(100, score);
  }

  /**
   * Calculate message length score (0-100)
   * Longer messages indicate more investment
   */
  private calculateMessageLengthScore(length: number): number {
    // Scoring curve: 50 chars = 20, 150 chars = 50, 300+ chars = 100
    if (length <= 20) return 5;
    if (length <= 50) return 20;
    if (length <= 100) return 40;
    if (length <= 150) return 50;
    if (length <= 200) return 70;
    if (length <= 300) return 85;
    return 100;
  }

  /**
   * Calculate question engagement score (0-100)
   * Questions show curiosity and engagement
   */
  private calculateQuestionScore(content: string): number {
    const questionCount = (content.match(/\?/g) || []).length;

    // 1 question = 40, 2 = 70, 3+ = 100
    if (questionCount === 0) return 0;
    if (questionCount === 1) return 40;
    if (questionCount === 2) return 70;
    return 100;
  }

  /**
   * Calculate topic depth score (0-100)
   * Measures follow-up and topical continuity
   */
  private calculateTopicDepthScore(words: string[], previousMessages: string[]): number {
    if (previousMessages.length === 0 || words.length === 0) return 50; // Neutral for first message

    // Create word set from current message (excluding common words)
    const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'up', 'about',
      'into', 'over', 'after', 'and', 'but', 'or', 'if', 'then', 'so', 'than',
      'that', 'this', 'these', 'those', 'it', 'its', 'you', 'your', 'what', 'how',
      'when', 'where', 'why', 'who', 'which', 'just', 'like', 'yeah', 'yes', 'no',
      'not', 'also', 'too', 'very', 'really', 'much', 'more', 'some', 'any', 'all',
    ]);

    const currentWords = new Set(words.filter(w => w.length > 3 && !commonWords.has(w)));

    // Get words from previous messages (last 3)
    const recentPrevious = previousMessages.slice(-3);
    const previousWordSet = new Set<string>();
    for (const msg of recentPrevious) {
      const msgWords = this.tokenize(msg.toLowerCase());
      for (const w of msgWords) {
        if (w.length > 3 && !commonWords.has(w)) {
          previousWordSet.add(w);
        }
      }
    }

    if (previousWordSet.size === 0 || currentWords.size === 0) return 50;

    // Calculate overlap
    let overlap = 0;
    for (const word of currentWords) {
      if (previousWordSet.has(word)) {
        overlap++;
      }
    }

    // Score based on overlap ratio
    const overlapRatio = overlap / Math.min(currentWords.size, 5);
    return Math.min(100, Math.round(overlapRatio * 100 + 30)); // Baseline of 30
  }

  /**
   * Calculate response time score (0-100)
   * Faster responses indicate higher engagement
   */
  private calculateResponseTimeScore(responseTimeMs: number | null): number {
    if (responseTimeMs === null) return 50; // Neutral if unknown

    const seconds = responseTimeMs / 1000;

    // Scoring: 10s = 100, 30s = 80, 60s = 60, 120s = 40, 300s+ = 20
    if (seconds <= 10) return 100;
    if (seconds <= 30) return 80;
    if (seconds <= 60) return 60;
    if (seconds <= 120) return 40;
    if (seconds <= 300) return 25;
    return 10;
  }
}

// Singleton instance
let engagementServiceInstance: EngagementService | null = null;

export function getEngagementService(): EngagementService {
  if (!engagementServiceInstance) {
    engagementServiceInstance = new EngagementService();
    logger.info('Engagement scoring service initialized');
  }
  return engagementServiceInstance;
}
