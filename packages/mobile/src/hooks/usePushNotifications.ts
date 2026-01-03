import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

export interface PushNotificationState {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  error: string | null;
}

export interface UsePushNotificationsReturn extends PushNotificationState {
  registerForPushNotifications: () => Promise<string | null>;
}

/**
 * Hook for managing push notifications
 */
export function usePushNotifications(
  onNotificationTap?: (notification: Notifications.NotificationResponse) => void
): UsePushNotificationsReturn {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  /**
   * Register for push notifications and get the Expo push token
   */
  const registerForPushNotifications = useCallback(async (): Promise<string | null> => {
    // Push notifications only work on physical devices
    if (!Device.isDevice) {
      console.log('[PushNotifications] Must use physical device');
      setError('Push notifications require a physical device');
      return null;
    }

    try {
      // Check existing permission
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      // Request permission if not already granted
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[PushNotifications] Permission denied');
        setError('Push notification permission denied');
        return null;
      }

      // Get the Expo push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        console.warn('[PushNotifications] No EAS project ID configured');
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: projectId,
      });

      const token = tokenData.data;
      setExpoPushToken(token);
      setError(null);

      console.log('[PushNotifications] Token:', token);

      // Configure Android channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Campfire',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF6B00',
          sound: 'default',
        });
      }

      return token;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to register';
      console.error('[PushNotifications] Registration error:', err);
      setError(message);
      return null;
    }
  }, []);

  // Set up notification listeners
  useEffect(() => {
    // Register on mount
    registerForPushNotifications();

    // Listen for incoming notifications (app in foreground)
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[PushNotifications] Received:', notification);
      setNotification(notification);
    });

    // Listen for notification taps
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('[PushNotifications] Tapped:', response);
      onNotificationTap?.(response);
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [registerForPushNotifications, onNotificationTap]);

  return {
    expoPushToken,
    notification,
    error,
    registerForPushNotifications,
  };
}

/**
 * Get the platform for push token registration
 */
export function getPushPlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}
