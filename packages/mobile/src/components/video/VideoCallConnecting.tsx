import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface VideoCallConnectingProps {
  companionName: string;
  companionAvatarUrl?: string;
  onCancel: () => void;
}

/**
 * Connecting screen shown while the video call room is being provisioned
 * and the LiveKit connection is being established.
 *
 * Displays a pulsing avatar placeholder and the companion name.
 */
export function VideoCallConnecting({
  companionName,
  companionAvatarUrl,
  onCancel,
}: VideoCallConnectingProps): React.JSX.Element {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.avatarContainer,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {companionName.charAt(0).toUpperCase()}
            </Text>
          </View>
        </Animated.View>

        <Text style={styles.name}>{companionName}</Text>
        <Text style={styles.statusText}>Connecting...</Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.7}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarContainer: {
    marginBottom: 24,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1A1A1A',
    borderWidth: 3,
    borderColor: '#FF6B00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FF6B00',
    fontSize: 48,
    fontWeight: '700',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
  },
  statusText: {
    color: '#999999',
    fontSize: 16,
  },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 24,
  },
  cancelButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
});
