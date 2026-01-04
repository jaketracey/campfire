/**
 * Native Bridge Utilities
 *
 * Provides an interface to communicate with the native mobile app
 * when running inside a WebView.
 */

declare global {
  interface Window {
    __CAMPFIRE_NATIVE__?: boolean;
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
    CampfireNativeBridge?: {
      startRecording: () => Promise<void>;
      stopRecording: () => Promise<{ audioData: string; duration: number }>;
      onRecordingComplete: (audioData: string, duration: number) => void;
      playAudio: (base64Mp3: string) => Promise<void>;
      stopAudio: () => void;
      onPlaybackComplete: () => void;
      syncAuth: (tokens: object) => void;
      registerPushToken: (token: string, platform: 'ios' | 'android') => void;
      isNative: () => boolean;
      requestGoogleAuth: (mode: 'signin' | 'signup') => Promise<{ idToken: string; mode: string }>;
      onGoogleAuthComplete: (idToken: string, mode: string) => void;
      onGoogleAuthError: (error: string) => void;
    };
  }
}

/**
 * Check if the app is running inside the native mobile app
 */
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && window.__CAMPFIRE_NATIVE__ === true;
}

/**
 * Get the native bridge interface
 * Returns null if not running in native app
 */
export function getNativeBridge(): Window['CampfireNativeBridge'] | null {
  if (isNativeApp() && window.CampfireNativeBridge) {
    return window.CampfireNativeBridge;
  }
  return null;
}

/**
 * Start native audio recording
 * Returns a promise that resolves when recording starts
 */
export async function startNativeRecording(): Promise<boolean> {
  const bridge = getNativeBridge();
  if (bridge) {
    await bridge.startRecording();
    return true;
  }
  return false;
}

/**
 * Stop native audio recording
 * Returns a promise with the recorded audio data
 */
export async function stopNativeRecording(): Promise<{ audioData: string; duration: number } | null> {
  const bridge = getNativeBridge();
  if (bridge) {
    return await bridge.stopRecording();
  }
  return null;
}

/**
 * Play audio through the native bridge
 */
export async function playNativeAudio(base64Mp3: string): Promise<boolean> {
  const bridge = getNativeBridge();
  if (bridge) {
    await bridge.playAudio(base64Mp3);
    return true;
  }
  return false;
}

/**
 * Stop native audio playback
 */
export function stopNativeAudio(): boolean {
  const bridge = getNativeBridge();
  if (bridge) {
    bridge.stopAudio();
    return true;
  }
  return false;
}

/**
 * Listen for native recording complete events
 */
export function onNativeRecordingComplete(
  callback: (data: { audioData: string; duration: number }) => void
): () => void {
  const handler = (event: CustomEvent<{ audioData: string; duration: number }>) => {
    callback(event.detail);
  };

  window.addEventListener('native-recording-complete', handler as EventListener);

  return () => {
    window.removeEventListener('native-recording-complete', handler as EventListener);
  };
}

/**
 * Listen for native playback complete events
 */
export function onNativePlaybackComplete(callback: () => void): () => void {
  const handler = () => {
    callback();
  };

  window.addEventListener('native-playback-complete', handler);

  return () => {
    window.removeEventListener('native-playback-complete', handler);
  };
}

/**
 * Request Google auth through native app
 * Returns the ID token on success, null on cancel
 */
export async function requestNativeGoogleAuth(
  mode: 'signin' | 'signup' = 'signin'
): Promise<string | null> {
  const bridge = getNativeBridge();
  if (!bridge?.requestGoogleAuth) {
    return null;
  }

  try {
    const result = await bridge.requestGoogleAuth(mode);
    return result.idToken;
  } catch (error) {
    console.error('[NativeBridge] Google auth error:', error);
    throw error;
  }
}

/**
 * Listen for native Google auth complete events
 */
export function onNativeGoogleAuthComplete(
  callback: (data: { idToken: string; mode: string }) => void
): () => void {
  const handler = (event: CustomEvent<{ idToken: string; mode: string }>) => {
    callback(event.detail);
  };

  window.addEventListener('native-google-auth-complete', handler as EventListener);

  return () => {
    window.removeEventListener('native-google-auth-complete', handler as EventListener);
  };
}

/**
 * Listen for native Google auth error events
 */
export function onNativeGoogleAuthError(callback: (error: string) => void): () => void {
  const handler = (event: CustomEvent<{ error: string }>) => {
    callback(event.detail.error);
  };

  window.addEventListener('native-google-auth-error', handler as EventListener);

  return () => {
    window.removeEventListener('native-google-auth-error', handler as EventListener);
  };
}
