import { z } from 'zod';

export const PublicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('https://ignite.cam'),
  NEXT_PUBLIC_GATEWAY_URL: z.string().url().optional(),
  NEXT_PUBLIC_WS_URL: z.string().url().optional(),
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  cachedPublicEnv ??= PublicEnvSchema.parse(process.env);
  return cachedPublicEnv;
}

export function resetPublicEnvForTests(): void {
  cachedPublicEnv = null;
}

export const publicEnv = getPublicEnv();

