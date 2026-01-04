import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: 'Ignite',
  slug: 'ignite',
  owner: 'jaketracey',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#000000',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'cam.ignite.app',
    buildNumber: '1',
    infoPlist: {
      NSMicrophoneUsageDescription:
        'Ignite needs microphone access for voice messages and calls with your companion.',
      UIBackgroundModes: ['audio', 'remote-notification'],
    },
    entitlements: {
      'aps-environment': 'production',
    },
    config: {
      usesNonExemptEncryption: false,
    },
    associatedDomains: ['applinks:ignite.cam'],
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#000000',
    },
    package: 'cam.ignite.app',
    versionCode: 1,
    permissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.VIBRATE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'ignite.cam',
            pathPrefix: '/chat',
          },
          {
            scheme: 'https',
            host: 'ignite.cam',
            pathPrefix: '/onboard',
          },
          {
            scheme: 'https',
            host: 'ignite.cam',
            pathPrefix: '/account',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    [
      'expo-notifications',
      {
        color: '#FF6B00',
      },
    ],
    [
      'expo-av',
      {
        microphonePermission:
          'Allow Ignite to access your microphone for voice messages and calls.',
      },
    ],
    'expo-secure-store',
    'expo-web-browser',
  ],
  scheme: 'ignite',
  extra: {
    webAppUrl: process.env.WEB_APP_URL || 'https://ignite.cam',
    // Google OAuth - Web Client ID is used to get ID token for backend verification
    googleWebClientId:
      process.env.GOOGLE_WEB_CLIENT_ID ||
      '562334365836-en94099fa2gif5a5soprbb1l5ftho20h.apps.googleusercontent.com',
    // iOS Client ID (optional - uses web client ID if not set)
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
    // Android Client ID (optional - uses web client ID if not set)
    googleAndroidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID,
    eas: {
      projectId: '244a43e2-87cc-4a23-b7f4-c50cf922f055',
    },
  },
  updates: {
    url: 'https://u.expo.dev/244a43e2-87cc-4a23-b7f4-c50cf922f055',
  },
  runtimeVersion: {
    policy: 'sdkVersion',
  },
});
