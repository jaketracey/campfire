# LiveKit React Native -- Native Module Setup

This document describes the native configuration required for `@livekit/react-native`
and `@livekit/react-native-webrtc` to work in the Campfire mobile app.

## Dependencies Added

```
@livekit/react-native ^2.4.0
@livekit/react-native-webrtc ^125.0.7
```

## iOS Setup

1. **Minimum deployment target**: iOS 14.0 (already met by Expo 54)

2. **Info.plist permissions** (already partially present for audio recording):
   - `NSMicrophoneUsageDescription` -- Required for voice
   - `NSCameraUsageDescription` -- Required for optional user camera
   - Add via `app.config.ts`:
     ```ts
     ios: {
       infoPlist: {
         NSCameraUsageDescription: "Camera is used for video calls with your companion",
       }
     }
     ```

3. **Background modes** (in `app.config.ts`):
   ```ts
   ios: {
     infoPlist: {
       UIBackgroundModes: ["audio", "voip"],
     }
   }
   ```

4. **Pod install**: Run `npx pod-install` after installing dependencies.

5. **Bitcode**: Must be disabled (Expo 54 already disables it).

## Android Setup

1. **Minimum SDK**: 24 (already met by Expo 54)

2. **Permissions** in `AndroidManifest.xml` (add via `app.config.ts` plugins):
   ```xml
   <uses-permission android:name="android.permission.CAMERA" />
   <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   <!-- Already present for audio recording -->
   ```

3. **Java 17**: Required for the WebRTC native module. Expo 54 uses Java 17 by default.

4. **ProGuard**: If using ProGuard/R8, add:
   ```
   -keep class org.webrtc.** { *; }
   -keep class com.livekit.** { *; }
   ```

## Expo Config Plugin

If using Expo managed workflow with EAS Build, create a config plugin or use
`expo-build-properties`:

```ts
// app.config.ts
plugins: [
  [
    "expo-build-properties",
    {
      android: {
        minSdkVersion: 24,
      },
      ios: {
        deploymentTarget: "14.0",
      },
    },
  ],
],
```

## Development vs Production

- **Expo Go**: LiveKit native modules will NOT work in Expo Go. You must use a
  development build (`npx expo run:ios` / `npx expo run:android`) or EAS Build.
- The `VideoCallService` uses dynamic `import()` for `@livekit/react-native` so
  the app does not crash when running in Expo Go -- it will show an error state
  instead.

## Screen Wake Lock

To keep the screen on during video calls, add `expo-keep-awake`:

```
npx expo install expo-keep-awake
```

Then in VideoCallScreen, call `activateKeepAwakeAsync()` on mount and
`deactivateKeepAwake()` on unmount.
