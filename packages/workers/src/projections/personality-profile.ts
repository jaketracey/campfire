import { Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { DbClient } from '../db/client.js';
import { env } from '../env.js';

interface PersonalityProfileJobData {
  type: 'analyze' | 'batch_check';
  userId?: string;
}

interface WorkerConfig {
  connection: Redis;
  db: DbClient;
  logger: Logger;
  orchestratorUrl?: string;
}

interface AnalysisResult {
  traits: {
    warmth?: number | null;
    energy?: number | null;
    humor?: number | null;
    formality?: number | null;
    curiosity?: number | null;
    openness?: number | null;
  };
  preferred_tone: string;
  verbosity: string;
  personality_insights: string[];
  detected_interests: string[];
  conversation_themes: string[];
  greeting_style: string;
  custom_insight: string;
}

export class PersonalityProfileProjectionWorker {
  private worker: Worker | null = null;
  private config: WorkerConfig;
  private orchestratorUrl: string;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.orchestratorUrl = config.orchestratorUrl ?? env.ORCHESTRATOR_URL;
  }

  async start() {
    this.worker = new Worker<PersonalityProfileJobData>(
      'personality-profile-projection',
      async (job) => this.process(job),
      {
        connection: this.config.connection,
        concurrency: 2, // Limit concurrency since LLM calls are expensive
      }
    );

    this.worker.on('completed', (job) => {
      this.config.logger.info({ jobId: job.id }, 'Personality profile projection completed');
    });

    this.worker.on('failed', (job, err) => {
      this.config.logger.error(
        { jobId: job?.id, error: err.message },
        'Personality profile projection failed'
      );
    });

    this.config.logger.info('Personality profile projection worker started');
  }

  async stop() {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async process(job: Job<PersonalityProfileJobData>): Promise<void> {
    const { type, userId } = job.data;

    switch (type) {
      case 'analyze':
        if (userId) {
          await this.analyzeUserProfile(userId);
        }
        break;
      case 'batch_check':
        await this.checkAndQueueAnalysis();
        break;
    }
  }

  /**
   * Analyze a single user's personality profile
   */
  private async analyzeUserProfile(userId: string): Promise<void> {
    this.config.logger.info({ userId }, 'Starting personality analysis');

    // Get user's recent sessions
    const sessions = await this.config.db.sql`
      SELECT id, turn_count FROM sessions
      WHERE user_id = ${userId}
      AND status IN ('active', 'ended')
      ORDER BY started_at DESC
      LIMIT 10
    `;

    // Get turns from those sessions
    const turns: { userMessage: string; agentMessage?: string }[] = [];

    for (const session of sessions) {
      const sessionTurns = await this.config.db.sql`
        SELECT user_message, agent_message FROM turns
        WHERE session_id = ${session.id}
        AND user_message IS NOT NULL
        ORDER BY turn_number
        LIMIT 50
      `;

      for (const turn of sessionTurns) {
        if (turn.user_message) {
          turns.push({
            userMessage: turn.user_message,
            agentMessage: turn.agent_message ?? undefined,
          });
        }
      }
    }

    if (turns.length < 10) {
      this.config.logger.info({ userId, turnCount: turns.length }, 'Insufficient turns for analysis');
      return;
    }

    // Get existing profile if any
    const [existingProfile] = await this.config.db.sql`
      SELECT * FROM user_personality_profiles WHERE user_id = ${userId}
    `;

    // Call orchestrator to analyze
    try {
      const response = await fetch(`${this.orchestratorUrl}/profile/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          turns: turns.slice(0, 100),
          existing_profile: existingProfile
            ? {
                traits: {
                  warmth: existingProfile.warmth,
                  energy: existingProfile.energy,
                  humor: existingProfile.humor,
                  formality: existingProfile.formality,
                  curiosity: existingProfile.curiosity,
                  openness: existingProfile.openness,
                },
                preferred_tone: existingProfile.preferred_tone,
                greeting_style: existingProfile.greeting_style,
              }
            : null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Orchestrator returned ${response.status}`);
      }

      const analysis = (await response.json()) as AnalysisResult;

      // Upsert the profile
      await this.config.db.sql`
        INSERT INTO user_personality_profiles (
          user_id,
          analysis_version,
          turns_analyzed,
          next_analysis_threshold,
          warmth,
          energy,
          humor,
          formality,
          curiosity,
          openness,
          preferred_tone,
          verbosity,
          personality_insights,
          detected_interests,
          conversation_themes,
          greeting_style,
          custom_insight
        ) VALUES (
          ${userId},
          ${'1.0.0'},
          ${turns.length},
          ${turns.length + 50},
          ${analysis.traits.warmth ?? null},
          ${analysis.traits.energy ?? null},
          ${analysis.traits.humor ?? null},
          ${analysis.traits.formality ?? null},
          ${analysis.traits.curiosity ?? null},
          ${analysis.traits.openness ?? null},
          ${analysis.preferred_tone ?? null},
          ${analysis.verbosity ?? null},
          ${JSON.stringify(analysis.personality_insights ?? [])},
          ${JSON.stringify(analysis.detected_interests ?? [])},
          ${JSON.stringify(analysis.conversation_themes ?? [])},
          ${analysis.greeting_style ?? 'friendly'},
          ${analysis.custom_insight ?? null}
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
          analysis_version = '1.0.0',
          turns_analyzed = ${turns.length},
          next_analysis_threshold = ${turns.length + 50},
          last_analysis_at = NOW(),
          warmth = ${analysis.traits.warmth ?? null},
          energy = ${analysis.traits.energy ?? null},
          humor = ${analysis.traits.humor ?? null},
          formality = ${analysis.traits.formality ?? null},
          curiosity = ${analysis.traits.curiosity ?? null},
          openness = ${analysis.traits.openness ?? null},
          preferred_tone = ${analysis.preferred_tone ?? null},
          verbosity = ${analysis.verbosity ?? null},
          personality_insights = ${JSON.stringify(analysis.personality_insights ?? [])},
          detected_interests = ${JSON.stringify(analysis.detected_interests ?? [])},
          conversation_themes = ${JSON.stringify(analysis.conversation_themes ?? [])},
          greeting_style = ${analysis.greeting_style ?? 'friendly'},
          custom_insight = ${analysis.custom_insight ?? null}
      `;

      this.config.logger.info(
        { userId, turnsAnalyzed: turns.length },
        'Personality profile analyzed and saved'
      );
    } catch (error) {
      this.config.logger.error(
        { userId, error: String(error) },
        'Failed to analyze personality profile'
      );
      throw error;
    }
  }

  /**
   * Check for users needing analysis and queue jobs
   */
  private async checkAndQueueAnalysis(): Promise<void> {
    this.config.logger.info('Checking for users needing personality analysis');

    // Get users whose total turns exceed their threshold
    const usersNeedingAnalysis = await this.config.db.sql`
      WITH user_turn_counts AS (
        SELECT
          s.user_id,
          SUM(s.turn_count) as total_turns
        FROM sessions s
        WHERE s.status IN ('active', 'ended')
        GROUP BY s.user_id
      )
      SELECT
        utc.user_id,
        utc.total_turns,
        COALESCE(upp.next_analysis_threshold, 50) as current_threshold
      FROM user_turn_counts utc
      LEFT JOIN user_personality_profiles upp ON utc.user_id = upp.user_id
      WHERE utc.total_turns >= COALESCE(upp.next_analysis_threshold, 50)
      ORDER BY utc.total_turns DESC
      LIMIT 100
    `;

    this.config.logger.info(
      { count: usersNeedingAnalysis.length },
      'Found users needing personality analysis'
    );

    // Queue individual analysis jobs
    if (this.worker) {
      const { Queue } = await import('bullmq');
      const queue = new Queue('personality-profile-projection', {
        connection: this.config.connection,
      });

      for (const user of usersNeedingAnalysis) {
        await queue.add('analyze', {
          type: 'analyze',
          userId: user.user_id,
        });
      }

      await queue.close();
    }
  }
}
