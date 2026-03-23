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

const NonEmptyStringSchema = z.string().min(1);

const OptionalUrlSchema = z.string().url().optional();

export const GatewayEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema.default('development'),
  PORT: IntSchema.pipe(z.number().int().positive()).default(3002),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) => {
      const raw = value?.split(',').map((s) => s.trim()).filter(Boolean);
      return raw && raw.length > 0 ? raw : ['http://localhost:3000', 'http://localhost:5173'];
    }),

  // Secrets (validated where required)
  JWT_SECRET: NonEmptyStringSchema.optional(),
  INTERNAL_SERVICE_KEY: NonEmptyStringSchema.optional(),

  JWT_ISSUER: z.string().default('campfire'),
  JWT_AUDIENCE: z.string().default('campfire-api'),
  JWT_EXPIRY: z.string().default('24h'),
  JWT_AFFILIATE_SECRET: z.string().optional(),

  // Database
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: IntSchema.pipe(z.number().int().positive()).default(5432),
  DATABASE_NAME: z.string().default('campfire'),
  DATABASE_USER: z.string().default('campfire'),
  DATABASE_PASSWORD: z.string().default('campfire'),
  DATABASE_SSL: BoolSchema.default(false),
  DATABASE_MAX_CONNECTIONS: IntSchema.pipe(z.number().int().positive()).default(20),
  DATABASE_CONNECTION_TIMEOUT: IntSchema.pipe(z.number().int().positive()).default(30),
  DATABASE_IDLE_TIMEOUT: IntSchema.pipe(z.number().int().nonnegative()).default(20),

  DATABASE_POOL_MAX: IntSchema.pipe(z.number().int().positive()).default(20),
  DATABASE_CONNECT_TIMEOUT: IntSchema.pipe(z.number().int().positive()).default(10),
  DATABASE_MAX_LIFETIME: IntSchema.pipe(z.number().int().positive()).default(3600),
  DATABASE_DEBUG: BoolSchema.default(false),

  // Orchestrator + URLs
  ORCHESTRATOR_URL: z.string().url().default('http://localhost:8000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  WEB_BASE_URL: OptionalUrlSchema,
  API_BASE_URL: z.string().url().default('https://ignite.cam'),
  APP_URL: z.string().url().default('https://app.campfire.ai'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Storage
  AWS_REGION: z.string().default('us-east-1'),
  S3_MEDIA_BUCKET: z.string().default('campfire-dev-media'),
  S3_CDN_URL: OptionalUrlSchema,

  // OpenTelemetry
  OTEL_SERVICE_NAME: z.string().default('campfire-gateway'),
  SERVICE_VERSION: z.string().default('0.1.0'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://localhost:4318'),
  OTEL_ENABLED: BoolSchema.default(true),

  // Sentry Error Monitoring
  SENTRY_DSN: z.string().url().optional(),

  // Optional integrations
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_REDIRECT_URI: OptionalUrlSchema,
  GOOGLE_ADS_API_URL: OptionalUrlSchema,

  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_ADS_REDIRECT_URI: OptionalUrlSchema,

  FLOWGUARD_API_URL: OptionalUrlSchema,
  FLOWGUARD_BASE_URL: OptionalUrlSchema,
  FLOWGUARD_SHOP_ID: z.string().optional(),
  FLOWGUARD_SIGNATURE_KEY: z.string().optional(),

  // Stripe Payment Processing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: IntSchema.pipe(z.number().int().positive()).optional(),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(),
  ELEVENLABS_TTS_MODEL: z.string().optional(),
  ELEVENLABS_STT_MODEL: z.string().optional(),

  // FAL.ai for LoRA training
  FAL_API_KEY: z.string().optional(),

  PROVIDER_KEY_ENCRYPTION_SECRET: z.string().optional(),

  // Database Seeding (Development Only)
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),

  // Creator monetization
  CREATOR_TOKEN_VALUE_CENTS: IntSchema.pipe(z.number().int().positive()).default(10),
  CREATOR_PLATFORM_FEE_BPS: IntSchema.pipe(z.number().int().min(0).max(10_000)).default(2000),
});

export type GatewayEnv = z.infer<typeof GatewayEnvSchema> & {
  JWT_SECRET_BYTES?: Uint8Array;
  INTERNAL_SERVICE_KEY_BUFFER?: Buffer;
  JWT_AFFILIATE_SECRET_BYTES?: Uint8Array;
};

export function parseGatewayEnv(input: NodeJS.ProcessEnv): GatewayEnv {
  const parsed = GatewayEnvSchema.parse(input);
  const serviceVersion = input['npm_package_version'] || parsed.SERVICE_VERSION;
  const jwtSecretBytes = parsed.JWT_SECRET ? new TextEncoder().encode(parsed.JWT_SECRET) : undefined;
  const internalServiceKeyBuffer = parsed.INTERNAL_SERVICE_KEY
    ? Buffer.from(parsed.INTERNAL_SERVICE_KEY)
    : undefined;
  const affiliateSecret = parsed.JWT_AFFILIATE_SECRET ?? parsed.JWT_SECRET;
  const affiliateSecretBytes = affiliateSecret ? new TextEncoder().encode(affiliateSecret) : undefined;

  return {
    ...parsed,
    SERVICE_VERSION: serviceVersion,
    JWT_SECRET_BYTES: jwtSecretBytes,
    INTERNAL_SERVICE_KEY_BUFFER: internalServiceKeyBuffer,
    JWT_AFFILIATE_SECRET_BYTES: affiliateSecretBytes,
  };
}

let cachedEnv: GatewayEnv | null = null;

export function getGatewayEnv(): GatewayEnv {
  cachedEnv ??= parseGatewayEnv(process.env);
  return cachedEnv;
}

export function resetGatewayEnvForTests(): void {
  cachedEnv = null;
}

export const env = getGatewayEnv();
