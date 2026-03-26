import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface VideoCallEndedProps {
  companionName: string;
  companionAvatarUrl?: string;
  durationSeconds: number;
  tokensUsed: number;
  onClose: () => void;
}

/**
 * Summary screen shown after a video call ends.
 * Displays call duration, token usage, and a close button.
 */
export function VideoCallEnded({
  companionName,
  companionAvatarUrl,
  durationSeconds,
  tokensUsed,
  onClose,
}: VideoCallEndedProps): React.JSX.Element {
  const formattedDuration = formatCallDuration(durationSeconds);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {companionName.charAt(0).toUpperCase()}
          </Text>
        </View>

        <Text style={styles.title}>Call Ended</Text>
        <Text style={styles.companionName}>{companionName}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formattedDuration}</Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
          {tokensUsed > 0 && (
            <View style={styles.stat}>
              <Text style={styles.statValue}>{tokensUsed}</Text>
              <Text style={styles.statLabel}>Tokens Used</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function formatCallDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hrs}h ${remainingMins}m`;
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
    padding: 32,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#1A1A1A',
    borderWidth: 2,
    borderColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarText: {
    color: '#FF6B00',
    fontSize: 40,
    fontWeight: '700',
  },
  title: {
    color: '#999999',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  companionName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 32,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 48,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  statLabel: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 24,
  },
  closeButton: {
    backgroundColor: '#FF6B00',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
