import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { WebViewContainer } from './src/components/WebViewContainer';

// Keep the splash screen visible until WebView content is ready
SplashScreen.preventAutoHideAsync();

export default function App(): React.JSX.Element {
  const onWebViewReady = React.useCallback(async () => {
    await SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <WebViewContainer onContentReady={onWebViewReady} />
    </SafeAreaProvider>
  );
}
