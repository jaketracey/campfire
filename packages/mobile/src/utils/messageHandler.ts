import type { WebView } from 'react-native-webview';
import type {
  BridgeMessage,
  AuthSyncPayload,
  AudioPlayPayload,
  PushTokenPayload,
  GoogleAuthRequestPayload,
} from '../types/bridge';
import { parseBridgeMessage } from '../types/bridge';
import { createCallbackScript } from './webViewInjection';

export interface MessageHandlerCallbacks {
  onAuthSync?: (payload: AuthSyncPayload) => void;
  onAudioRecordStart?: () => void;
  onAudioRecordStop?: () => Promise<{ audioData: string; duration: number }>;
  onAudioPlay?: (payload: AudioPlayPayload) => Promise<void>;
  onAudioStop?: () => void;
  onPushToken?: (payload: PushTokenPayload) => void;
  onGoogleAuthRequest?: (payload: GoogleAuthRequestPayload) => Promise<string | null>;
}

/**
 * Create a message handler for WebView messages
 */
export function createMessageHandler(
  webViewRef: React.RefObject<WebView | null>,
  callbacks: MessageHandlerCallbacks
) {
  return async (event: { nativeEvent: { data: string } }) => {
    const message = parseBridgeMessage(event);
    if (!message) {
      return;
    }

    switch (message.type) {
      case 'AUTH_SYNC':
        callbacks.onAuthSync?.(message.payload as AuthSyncPayload);
        break;

      case 'AUDIO_RECORD_START':
        callbacks.onAudioRecordStart?.();
        break;

      case 'AUDIO_RECORD_STOP':
        if (callbacks.onAudioRecordStop) {
          try {
            const result = await callbacks.onAudioRecordStop();
            // Send result back to WebView
            webViewRef.current?.injectJavaScript(
              createCallbackScript('onRecordingComplete', result.audioData, result.duration)
            );
          } catch (error) {
            console.error('[MessageHandler] Recording error:', error);
            // Send empty result on error
            webViewRef.current?.injectJavaScript(
              createCallbackScript('onRecordingComplete', '', 0)
            );
          }
        }
        break;

      case 'AUDIO_PLAY':
        if (callbacks.onAudioPlay) {
          try {
            await callbacks.onAudioPlay(message.payload as AudioPlayPayload);
            // Notify WebView that playback is complete
            webViewRef.current?.injectJavaScript(createCallbackScript('onPlaybackComplete'));
          } catch (error) {
            console.error('[MessageHandler] Playback error:', error);
            webViewRef.current?.injectJavaScript(createCallbackScript('onPlaybackComplete'));
          }
        }
        break;

      case 'AUDIO_STOP':
        callbacks.onAudioStop?.();
        break;

      case 'PUSH_TOKEN':
        callbacks.onPushToken?.(message.payload as PushTokenPayload);
        break;

      case 'GOOGLE_AUTH_REQUEST':
        if (callbacks.onGoogleAuthRequest) {
          const payload = message.payload as GoogleAuthRequestPayload;
          try {
            const idToken = await callbacks.onGoogleAuthRequest(payload);
            if (idToken) {
              // Send token back to WebView
              webViewRef.current?.injectJavaScript(
                createCallbackScript('onGoogleAuthComplete', idToken, payload.mode)
              );
            } else {
              // User cancelled or auth failed
              webViewRef.current?.injectJavaScript(
                createCallbackScript('onGoogleAuthError', 'Authentication cancelled')
              );
            }
          } catch (error) {
            console.error('[MessageHandler] Google auth error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
            webViewRef.current?.injectJavaScript(
              createCallbackScript('onGoogleAuthError', errorMessage)
            );
          }
        }
        break;

      default:
        console.log('[MessageHandler] Unknown message type:', message.type);
    }
  };
}

/**
 * Inject a navigation command into the WebView
 */
export function navigateWebView(webViewRef: React.RefObject<WebView | null>, path: string): void {
  webViewRef.current?.injectJavaScript(`
    window.location.href = ${JSON.stringify(path)};
    true;
  `);
}

/**
 * Check if a URL should be blocked (e.g., admin routes)
 */
export function shouldBlockUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Block admin routes
    if (urlObj.pathname.startsWith('/admin')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a URL is an allowed route for the mobile app
 */
export function isAllowedRoute(url: string, baseUrl: string): boolean {
  try {
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);

    // Must be same origin
    if (urlObj.origin !== baseUrlObj.origin) {
      return true; // Allow external URLs to open in browser
    }

    // Block admin routes
    if (shouldBlockUrl(url)) {
      return false;
    }

    return true;
  } catch {
    return true;
  }
}
