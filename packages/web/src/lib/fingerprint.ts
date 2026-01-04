/**
 * Device Fingerprinting
 * Generates a stable fingerprint for anonymous user identification.
 */

import FingerprintJS, { type Agent } from '@fingerprintjs/fingerprintjs';

// Cache the fingerprint agent and result in memory
let agentPromise: Promise<Agent> | null = null;
let cachedFingerprint: string | null = null;

/**
 * Get or initialize the FingerprintJS agent
 */
async function getAgent(): Promise<Agent> {
  if (!agentPromise) {
    agentPromise = FingerprintJS.load();
  }
  return agentPromise;
}

/**
 * Get a stable device fingerprint for the current browser.
 * The fingerprint is cached in memory after first load.
 *
 * @returns A stable fingerprint string (visitor ID)
 */
export async function getDeviceFingerprint(): Promise<string> {
  // Return cached fingerprint if available
  if (cachedFingerprint) {
    return cachedFingerprint;
  }

  try {
    const agent = await getAgent();
    const result = await agent.get();

    // Cache the fingerprint for subsequent calls
    cachedFingerprint = result.visitorId;

    return result.visitorId;
  } catch (error) {
    console.error('[Fingerprint] Failed to generate fingerprint:', error);

    // Fallback to a random ID stored in localStorage
    // This is less stable but better than failing completely
    const storageKey = 'campfire_fallback_fp';
    let fallbackId = localStorage.getItem(storageKey);

    if (!fallbackId) {
      fallbackId = crypto.randomUUID();
      localStorage.setItem(storageKey, fallbackId);
    }

    cachedFingerprint = fallbackId;
    return fallbackId;
  }
}

/**
 * Clear the cached fingerprint (useful for testing)
 */
export function clearFingerprintCache(): void {
  cachedFingerprint = null;
}
