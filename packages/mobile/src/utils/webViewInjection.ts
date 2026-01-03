/**
 * JavaScript to inject into the WebView
 * Creates the native bridge interface and intercepts auth storage
 */
export const BRIDGE_INJECTION_SCRIPT = `
(function() {
  // Prevent double initialization
  if (window.__CAMPFIRE_NATIVE__) {
    return;
  }

  // Flag to detect native app context
  window.__CAMPFIRE_NATIVE__ = true;

  // Recording state
  let isRecording = false;
  let recordingResolve = null;

  // Playback state
  let isPlaying = false;
  let playbackResolve = null;

  // Native bridge interface
  window.CampfireNativeBridge = {
    // Audio Recording
    startRecording: function() {
      if (isRecording) return Promise.resolve();
      isRecording = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'AUDIO_RECORD_START'
      }));
      return Promise.resolve();
    },

    stopRecording: function() {
      return new Promise(function(resolve) {
        if (!isRecording) {
          resolve({ audioData: '', duration: 0 });
          return;
        }
        recordingResolve = resolve;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'AUDIO_RECORD_STOP'
        }));
      });
    },

    // Called by native when recording is complete
    onRecordingComplete: function(audioData, duration) {
      isRecording = false;
      if (recordingResolve) {
        recordingResolve({ audioData: audioData, duration: duration });
        recordingResolve = null;
      }
      // Dispatch event for web hooks to consume
      window.dispatchEvent(new CustomEvent('native-recording-complete', {
        detail: { audioData: audioData, duration: duration }
      }));
    },

    // Audio Playback
    playAudio: function(base64Mp3) {
      return new Promise(function(resolve) {
        if (isPlaying) {
          // Stop current playback first
          window.CampfireNativeBridge.stopAudio();
        }
        isPlaying = true;
        playbackResolve = resolve;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'AUDIO_PLAY',
          payload: { data: base64Mp3 }
        }));
      });
    },

    stopAudio: function() {
      if (!isPlaying) return;
      isPlaying = false;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'AUDIO_STOP'
      }));
      if (playbackResolve) {
        playbackResolve();
        playbackResolve = null;
      }
    },

    // Called by native when playback is complete
    onPlaybackComplete: function() {
      isPlaying = false;
      if (playbackResolve) {
        playbackResolve();
        playbackResolve = null;
      }
      window.dispatchEvent(new CustomEvent('native-playback-complete'));
    },

    // Auth Sync - called when auth state changes
    syncAuth: function(tokens) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'AUTH_SYNC',
        payload: tokens
      }));
    },

    // Push Notification Token
    registerPushToken: function(token, platform) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'PUSH_TOKEN',
        payload: { token: token, platform: platform }
      }));
    },

    // Check if running in native app
    isNative: function() {
      return true;
    },

    // Google Auth - triggers native Google Sign-In
    requestGoogleAuth: function(mode) {
      return new Promise(function(resolve, reject) {
        window.__googleAuthResolve = resolve;
        window.__googleAuthReject = reject;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'GOOGLE_AUTH_REQUEST',
          payload: { mode: mode || 'signin' }
        }));
      });
    },

    // Called by native when Google auth completes
    onGoogleAuthComplete: function(idToken, mode) {
      if (window.__googleAuthResolve) {
        window.__googleAuthResolve({ idToken: idToken, mode: mode });
        window.__googleAuthResolve = null;
        window.__googleAuthReject = null;
      }
      // Dispatch event for components to consume
      window.dispatchEvent(new CustomEvent('native-google-auth-complete', {
        detail: { idToken: idToken, mode: mode }
      }));
    },

    // Called by native when Google auth fails
    onGoogleAuthError: function(error) {
      if (window.__googleAuthReject) {
        window.__googleAuthReject(new Error(error));
        window.__googleAuthResolve = null;
        window.__googleAuthReject = null;
      }
      window.dispatchEvent(new CustomEvent('native-google-auth-error', {
        detail: { error: error }
      }));
    }
  };

  // Intercept localStorage for auth sync
  var originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    originalSetItem(key, value);
    // Sync auth state to native when it changes
    if (key === 'campfire-auth') {
      try {
        var auth = JSON.parse(value);
        if (auth && auth.state) {
          window.CampfireNativeBridge.syncAuth(auth.state);
        }
      } catch(e) {
        // Ignore parse errors
      }
    }
  };

  // Log that native bridge is ready
  console.log('[Campfire Native] Bridge initialized');
})();

true; // Required for injectedJavaScript to work
`;

/**
 * Script to inject initial auth tokens into localStorage
 */
export function createAuthInjectionScript(authState: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user?: object;
}): string {
  const stateJson = JSON.stringify({
    state: authState,
    version: 0,
  });

  return `
    (function() {
      try {
        localStorage.setItem('campfire-auth', ${JSON.stringify(stateJson)});
        console.log('[Campfire Native] Auth tokens injected');
      } catch(e) {
        console.error('[Campfire Native] Failed to inject auth:', e);
      }
    })();
    true;
  `;
}

/**
 * Script to trigger callbacks from native to web
 */
export function createCallbackScript(
  method: 'onRecordingComplete' | 'onPlaybackComplete' | 'onGoogleAuthComplete' | 'onGoogleAuthError',
  ...args: (string | number)[]
): string {
  const argsStr = args.map((arg) => JSON.stringify(arg)).join(', ');
  return `
    if (window.CampfireNativeBridge && window.CampfireNativeBridge.${method}) {
      window.CampfireNativeBridge.${method}(${argsStr});
    }
    true;
  `;
}

/**
 * Script to trigger Google login with native ID token
 */
export function createGoogleLoginScript(idToken: string, isSignup: boolean): string {
  return `
    (function() {
      // Dispatch the native auth complete event
      if (window.CampfireNativeBridge && window.CampfireNativeBridge.onGoogleAuthComplete) {
        window.CampfireNativeBridge.onGoogleAuthComplete(${JSON.stringify(idToken)}, ${isSignup ? "'signup'" : "'signin'"});
      }
      console.log('[Campfire Native] Google auth token received');
    })();
    true;
  `;
}
