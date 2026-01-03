import { useCallback, useEffect } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';

// Complete auth session for web browser redirects
WebBrowser.maybeCompleteAuthSession();

// Get client IDs from config
const GOOGLE_WEB_CLIENT_ID = Constants.expoConfig?.extra?.googleWebClientId;
const GOOGLE_IOS_CLIENT_ID = Constants.expoConfig?.extra?.googleIosClientId;
const GOOGLE_ANDROID_CLIENT_ID = Constants.expoConfig?.extra?.googleAndroidClientId;

export interface UseGoogleAuthReturn {
  signIn: () => Promise<string | null>;
  isReady: boolean;
}

/**
 * Hook for native Google Sign-In
 * Returns an idToken that can be sent to the backend
 */
export function useGoogleAuth(): UseGoogleAuthReturn {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
  });

  const signIn = useCallback(async (): Promise<string | null> => {
    try {
      const result = await promptAsync();

      if (result.type === 'success') {
        // Get the ID token from the authentication response
        const idToken = result.params.id_token;
        console.log('[GoogleAuth] Got ID token');
        return idToken;
      } else if (result.type === 'cancel') {
        console.log('[GoogleAuth] User cancelled');
        return null;
      } else {
        console.log('[GoogleAuth] Auth failed:', result.type);
        return null;
      }
    } catch (error) {
      console.error('[GoogleAuth] Error:', error);
      return null;
    }
  }, [promptAsync]);

  return {
    signIn,
    isReady: !!request,
  };
}
