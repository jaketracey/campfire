import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: 'Campfire',
  slug: 'campfire',
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
    bundleIdentifier: 'app.campfire.mobile',
    buildNumber: '1',
    infoPlist: {
      NSMicrophoneUsageDescription:
        'Campfire needs microphone access for voice messages and calls with your companion.',
      UIBackgroundModes: ['audio', 'remote-notification'],
    },
    entitlements: {
      'aps-environment': 'production',
    },
    associatedDomains: ['applinks:campfire.noice.work'],
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
    package: 'app.campfire.mobile',
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
            host: 'campfire.noice.work',
            pathPrefix: '/chat',
          },
          {
            scheme: 'https',
            host: 'campfire.noice.work',
            pathPrefix: '/onboard',
          },
          {
            scheme: 'https',
            host: 'campfire.noice.work',
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
          'Allow Campfire to access your microphone for voice messages and calls.',
      },
    ],
    'expo-secure-store',
    'expo-web-browser',
  ],
  scheme: 'campfire',
  extra: {
    webAppUrl: process.env.WEB_APP_URL || 'https://campfire.noice.work',
    // Google OAuth - Web Client ID is used to get ID token for backend verification
    googleWebClientId:
      process.env.GOOGLE_WEB_CLIENT_ID ||
      '562334365836-en94099fa2gif5a5soprbb1l5ftho20h.apps.googleusercontent.com',
    // iOS Client ID (optional - uses web client ID if not set)
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
    // Android Client ID (optional - uses web client ID if not set)
    googleAndroidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID,
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
  updates: {
    url: process.env.EAS_PROJECT_ID
      ? `https://u.expo.dev/${process.env.EAS_PROJECT_ID}`
      : undefined,
  },
  runtimeVersion: {
    policy: 'sdkVersion',
  },
});
