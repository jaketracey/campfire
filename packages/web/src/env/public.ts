import { z } from 'zod';

export const PublicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('https://ignite.cam'),
  NEXT_PUBLIC_GATEWAY_URL: z.string().url().optional(),
  NEXT_PUBLIC_WS_URL: z.string().url().optional(),
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  NEXT_PUBLIC_FLOWGUARD_SHOP_ID: z.string().optional(),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;

/**
 * Get public environment variables.
 *
 * IMPORTANT: Next.js only inlines process.env.NEXT_PUBLIC_* at build time
 * when accessed directly. We must explicitly access each variable here
 * for the values to be baked into the client bundle.
 */
export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;

  // Explicitly access each env var so Next.js can inline them at build time
  cachedPublicEnv = PublicEnvSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_FLOWGUARD_SHOP_ID: process.env.NEXT_PUBLIC_FLOWGUARD_SHOP_ID,
  });

  return cachedPublicEnv;
}

export function resetPublicEnvForTests(): void {
  cachedPublicEnv = null;
}

export const publicEnv = getPublicEnv();

