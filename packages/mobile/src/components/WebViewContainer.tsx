import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Platform,
  BackHandler,
  Linking,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

import { BRIDGE_INJECTION_SCRIPT, createAuthInjectionScript } from '../utils/webViewInjection';
import { createMessageHandler, shouldBlockUrl } from '../utils/messageHandler';
import { audioRecordingService } from '../services/AudioRecordingService';
import { audioPlaybackService } from '../services/AudioPlaybackService';
import { useDeepLinking } from '../hooks/useDeepLinking';
import { usePushNotifications, getPushPlatform } from '../hooks/usePushNotifications';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
import type { AuthSyncPayload, PushTokenPayload, GoogleAuthRequestPayload } from '../types/bridge';

const AUTH_STORAGE_KEY = 'campfire_auth';

interface WebViewContainerProps {
  /** Optional initial path to navigate to */
  initialPath?: string;
}

export function WebViewContainer({ initialPath }: WebViewContainerProps): React.JSX.Element {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);

  // Get base URL from config
  const baseUrl = Constants.expoConfig?.extra?.webAppUrl || 'https://app.campfire.app';
  const initialUrl = initialPath ? `${baseUrl}${initialPath}` : baseUrl;

  // Push notifications
  const { expoPushToken } = usePushNotifications((response) => {
    // Handle notification tap - navigate to the appropriate screen
    const data = response.notification.request.content.data;
    if (data?.path) {
      webViewRef.current?.injectJavaScript(`
        window.location.href = '${data.path}';
        true;
      `);
    }
  });

  // Deep linking
  useDeepLinking(webViewRef, { baseUrl });

  // Native Google Auth
  const { signIn: googleSignIn, isReady: googleAuthReady } = useGoogleAuth();

  /**
   * Save auth tokens to secure storage
   */
  const saveAuthTokens = useCallback(async (payload: AuthSyncPayload) => {
    try {
      await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(payload));
      console.log('[WebView] Auth tokens saved');
    } catch (error) {
      console.error('[WebView] Failed to save auth tokens:', error);
    }
  }, []);

  /**
   * Load auth tokens from secure storage
   */
  const loadAuthTokens = useCallback(async (): Promise<AuthSyncPayload | null> => {
    try {
      const stored = await SecureStore.getItemAsync(AUTH_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('[WebView] Failed to load auth tokens:', error);
    }
    return null;
  }, []);

  /**
   * Handle push token registration with backend
   */
  const handlePushToken = useCallback(async (payload: PushTokenPayload) => {
    console.log('[WebView] Push token received:', payload.token);
    // The web app will handle sending this to the backend
    // via its normal API client
  }, []);

  /**
   * Handle Google auth request from WebView
   */
  const handleGoogleAuthRequest = useCallback(
    async (payload: GoogleAuthRequestPayload): Promise<string | null> => {
      console.log('[WebView] Google auth requested, mode:', payload.mode);

      if (!googleAuthReady) {
        console.log('[WebView] Google auth not ready yet');
        return null;
      }

      try {
        const idToken = await googleSignIn();
        console.log('[WebView] Google auth result:', idToken ? 'success' : 'cancelled');
        return idToken;
      } catch (error) {
        console.error('[WebView] Google auth error:', error);
        throw error;
      }
    },
    [googleSignIn, googleAuthReady]
  );

  /**
   * Create message handler with all callbacks
   */
  const handleMessage = createMessageHandler(webViewRef, {
    onAuthSync: saveAuthTokens,
    onAudioRecordStart: async () => {
      await audioRecordingService.startRecording();
    },
    onAudioRecordStop: async () => {
      return await audioRecordingService.stopRecording();
    },
    onAudioPlay: async (payload) => {
      await audioPlaybackService.playAudio(payload.data);
    },
    onAudioStop: async () => {
      await audioPlaybackService.stopAudio();
    },
    onPushToken: handlePushToken,
    onGoogleAuthRequest: handleGoogleAuthRequest,
  });

  /**
   * Handle navigation state changes
   */
  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);

    // Check for blocked routes
    if (shouldBlockUrl(navState.url)) {
      webViewRef.current?.goBack();
    }
  }, []);

  /**
   * Handle navigation requests (before navigation)
   */
  const handleShouldStartLoadWithRequest = useCallback(
    (request: { url: string }) => {
      const { url } = request;

      // Block admin routes
      if (shouldBlockUrl(url)) {
        return false;
      }

      // Handle external URLs - open in system browser
      try {
        const urlObj = new URL(url);
        const baseUrlObj = new URL(baseUrl);

        // Open Google OAuth in external browser (Google blocks WebView sign-in)
        if (
          urlObj.hostname.includes('accounts.google.com') ||
          urlObj.hostname.includes('googleapis.com')
        ) {
          console.log('[WebView] Opening Google auth in external browser:', url);
          Linking.openURL(url);
          return false;
        }

        if (urlObj.origin !== baseUrlObj.origin) {
          Linking.openURL(url);
          return false;
        }
      } catch {
        // Invalid URL, allow it to fail naturally
      }

      return true;
    },
    [baseUrl]
  );

  /**
   * Handle Android back button
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handleBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => {
      subscription.remove();
    };
  }, [canGoBack]);

  /**
   * Inject stored auth tokens when WebView loads
   */
  const handleLoadEnd = useCallback(async () => {
    setIsLoading(false);

    // Inject stored auth tokens
    const authTokens = await loadAuthTokens();
    if (authTokens) {
      const script = createAuthInjectionScript(authTokens);
      webViewRef.current?.injectJavaScript(script);
    }

    // Send push token to web app if available
    if (expoPushToken) {
      webViewRef.current?.injectJavaScript(`
        if (window.CampfireNativeBridge) {
          window.CampfireNativeBridge.registerPushToken('${expoPushToken}', '${getPushPlatform()}');
        }
        true;
      `);
    }
  }, [loadAuthTokens, expoPushToken]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />
      <WebView
        ref={webViewRef}
        source={{ uri: initialUrl }}
        style={styles.webview}
        injectedJavaScript={BRIDGE_INJECTION_SCRIPT}
        onMessage={handleMessage}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
        onLoadEnd={handleLoadEnd}
        onLoadStart={() => setIsLoading(true)}
        // Security settings
        javaScriptEnabled={true}
        domStorageEnabled={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        // Performance settings
        cacheEnabled={true}
        cacheMode="LOAD_DEFAULT"
        // Media settings
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        // iOS specific
        allowsBackForwardNavigationGestures={true}
        // Android specific
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="compatibility"
        // Scrolling
        bounces={false}
        overScrollMode="never"
        // User agent
        applicationNameForUserAgent="CampfireApp/1.0"
      />
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FF6B00" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
