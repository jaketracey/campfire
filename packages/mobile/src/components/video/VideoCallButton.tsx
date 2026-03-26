import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

interface VideoCallButtonProps {
  /** Called when the user taps to initiate a video call */
  onPress: () => void;
  /** Disable the button (e.g. during loading or if video calls are unavailable) */
  disabled?: boolean;
}

/**
 * Button placed on the chat screen to initiate a video call with the companion.
 * Styled to match the Campfire orange brand color.
 */
export function VideoCallButton({ onPress, disabled = false }: VideoCallButtonProps): React.JSX.Element {
  const handlePress = async () => {
    if (disabled) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Haptics not available
    }
    onPress();
  };

  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={disabled}
      accessibilityLabel="Start video call"
      accessibilityRole="button"
    >
      <Text style={styles.icon}>{'\u{1F4F9}'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF6B00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 18,
  },
});
