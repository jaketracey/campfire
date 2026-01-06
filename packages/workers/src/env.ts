import { z } from 'zod';

const NodeEnvSchema = z.enum(['development', 'test', 'production']);

const BoolSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const IntSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return undefined;
  return Number(value);
}, z.number().int());

export const WorkersEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema.default('development'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  AWS_REGION: z.string().default('us-east-1'),
  S3_VAULT_BUCKET: z.string().default('campfire-dev-vault'),
  S3_MEDIA_BUCKET: z.string().default('campfire-dev-media'),
  S3_BUCKET_MEDIA: z.string().optional(),

  ORCHESTRATOR_URL: z.string().url().default('http://localhost:8000'),
  WEB_URL: z.string().url().default('https://ignite.cam'),

  OPENAI_API_KEY: z.string().optional(),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3'),

  EMAIL_UNSUBSCRIBE_SECRET: z.string().default('dev-secret'),

  SES_MAX_SEND_RATE: IntSchema.pipe(z.number().int().positive()).default(14),
  SES_REGION: z.string().default('us-east-1'),
  SES_SENDER_EMAIL: z.string().default('noreply@ignite.cam'),
  SES_SENDER_NAME: z.string().default('Ignite'),
  SES_REPLY_TO_EMAIL: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),
  SES_SANDBOX_MODE: BoolSchema.default(false),

  GOOGLE_ADS_API_URL: z.string().url().default('https://googleads.googleapis.com'),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),

  FACEBOOK_ADS_API_URL: z.string().url().default('https://graph.facebook.com/v18.0'),
  FACEBOOK_ADS_APP_ID: z.string().optional(),
  FACEBOOK_ADS_APP_SECRET: z.string().optional(),
});

export type WorkersEnv = z.infer<typeof WorkersEnvSchema>;

export function parseWorkersEnv(input: NodeJS.ProcessEnv): WorkersEnv {
  const parsed = WorkersEnvSchema.parse(input);
  return parsed;
}

let cachedEnv: WorkersEnv | null = null;

export function getWorkersEnv(): WorkersEnv {
  cachedEnv ??= parseWorkersEnv(process.env);
  return cachedEnv;
}

export function resetWorkersEnvForTests(): void {
  cachedEnv = null;
}

export const env = getWorkersEnv();

