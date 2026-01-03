import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { WebViewContainer } from './src/components/WebViewContainer';

// Keep the splash screen visible while we load
SplashScreen.preventAutoHideAsync();

export default function App(): React.JSX.Element {
  const onReady = React.useCallback(async () => {
    // Hide splash screen once the app is ready
    await SplashScreen.hideAsync();
  }, []);

  React.useEffect(() => {
    onReady();
  }, [onReady]);

  return (
    <SafeAreaProvider>
      <WebViewContainer />
    </SafeAreaProvider>
  );
}
