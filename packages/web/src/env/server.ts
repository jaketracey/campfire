import 'server-only';

import { z } from 'zod';
import { PublicEnvSchema } from './public';

const ServerEnvSchema = z
  .object({
    GATEWAY_URL: z.string().url().default('http://localhost:4000'),
  })
  .merge(PublicEnvSchema);

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= ServerEnvSchema.parse(process.env);
  return cachedServerEnv;
}

export function resetServerEnvForTests(): void {
  cachedServerEnv = null;
}

export const serverEnv = getServerEnv();
