import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useVideoCall } from '../hooks/useVideoCall';
import { VideoCallConnecting } from '../components/video/VideoCallConnecting';
import { VideoCallEnded } from '../components/video/VideoCallEnded';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface VideoCallScreenProps {
  companionId: string;
  companionName: string;
  companionAvatarUrl?: string;
  onClose: () => void;
}

/**
 * Full-screen video call view.
 *
 * Renders the companion avatar video stream (via LiveKit) with overlays for
 * companion name, duration, controls, and network quality. Handles connecting,
 * active, and ended lifecycle states.
 */
export function VideoCallScreen({
  companionId,
  companionName,
  companionAvatarUrl,
  onClose,
}: VideoCallScreenProps): React.JSX.Element {
  const {
    status,
    isConnected,
    room,
    error,
    duration,
    isMicMuted,
    isCameraEnabled,
    isSpeakerOn,
    networkQuality,
    summary,
    startCall,
    endCall,
    toggleMic,
    toggleCamera,
    toggleSpeaker,
    reset,
  } = useVideoCall();

  // Start the call when screen mounts
  useEffect(() => {
    startCall(companionId);
  }, [companionId, startCall]);

  const handleEndCall = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      // Haptics not available
    }
    await endCall();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // --- Connecting state ---
  if (status === 'requesting' || status === 'connecting') {
    return (
      <VideoCallConnecting
        companionName={companionName}
        companionAvatarUrl={companionAvatarUrl}
        onCancel={handleClose}
      />
    );
  }

  // --- Ended state ---
  if (status === 'ended') {
    return (
      <VideoCallEnded
        companionName={companionName}
        companionAvatarUrl={companionAvatarUrl}
        durationSeconds={summary?.durationSeconds || duration}
        tokensUsed={summary?.tokensUsed || 0}
        onClose={handleClose}
      />
    );
  }

  // --- Error state ---
  if (status === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorOverlay}>
          <Text style={styles.errorIcon}>!</Text>
          <Text style={styles.errorTitle}>Call Failed</Text>
          <Text style={styles.errorMessage}>{error || 'Something went wrong'}</Text>
          <TouchableOpacity style={styles.errorButton} onPress={handleClose}>
            <Text style={styles.errorButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- Active / reconnecting call ---
  const costPerMin = room?.costPerMinute || 0;
  const estimatedTokens = Math.ceil((duration / 60) * costPerMin);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" hidden={Platform.OS === 'android'} />

      {/* Remote video -- placeholder until LiveKit VideoView is wired */}
      <View style={styles.remoteVideo}>
        <Text style={styles.remoteVideoPlaceholder}>
          {companionName}
        </Text>
        {/*
          When LiveKit native module is available, replace with:
          <VideoView style={styles.remoteVideoStream} videoTrack={remoteVideoTrack} />
        */}
      </View>

      {/* Reconnecting overlay */}
      {status === 'reconnecting' && (
        <View style={styles.reconnectingOverlay}>
          <Text style={styles.reconnectingText}>Reconnecting...</Text>
        </View>
      )}

      {/* Top bar: companion name + duration + network quality */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarContent}>
          <View style={styles.topLeft}>
            <Text style={styles.companionName} numberOfLines={1}>
              {companionName}
            </Text>
            <NetworkIndicator quality={networkQuality} />
          </View>
          <View style={styles.topRight}>
            <Text style={styles.duration}>{formatDuration(duration)}</Text>
            {costPerMin > 0 && (
              <Text style={styles.tokenCost}>
                {estimatedTokens} tokens
              </Text>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom control bar */}
      <SafeAreaView style={styles.bottomBar} edges={['bottom']}>
        <View style={styles.controls}>
          <ControlButton
            icon={isMicMuted ? 'mic-off' : 'mic'}
            label={isMicMuted ? 'Unmute' : 'Mute'}
            active={!isMicMuted}
            onPress={toggleMic}
          />
          <ControlButton
            icon={isCameraEnabled ? 'camera' : 'camera-off'}
            label={isCameraEnabled ? 'Camera' : 'Camera'}
            active={isCameraEnabled}
            onPress={toggleCamera}
          />
          <ControlButton
            icon="phone-end"
            label="End"
            variant="danger"
            onPress={handleEndCall}
          />
          <ControlButton
            icon={isSpeakerOn ? 'speaker' : 'earpiece'}
            label={isSpeakerOn ? 'Speaker' : 'Earpiece'}
            active={isSpeakerOn}
            onPress={toggleSpeaker}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

// ---- Sub-components ----

function NetworkIndicator({ quality }: { quality: string }): React.JSX.Element {
  const color =
    quality === 'excellent'
      ? '#4CAF50'
      : quality === 'good'
        ? '#8BC34A'
        : quality === 'poor'
          ? '#FF5722'
          : '#999999';

  return (
    <View style={[styles.networkDot, { backgroundColor: color }]} />
  );
}

interface ControlButtonProps {
  icon: string;
  label: string;
  active?: boolean;
  variant?: 'default' | 'danger';
  onPress: () => void;
}

function ControlButton({ icon, label, active, variant = 'default', onPress }: ControlButtonProps): React.JSX.Element {
  // Map icon names to simple text symbols. In a real app, these would be
  // vector icons from @expo/vector-icons or similar.
  const iconMap: Record<string, string> = {
    'mic': '\u{1F399}',
    'mic-off': '\u{1F507}',
    'camera': '\u{1F4F7}',
    'camera-off': '\u{1F6AB}',
    'phone-end': '\u{1F4DE}',
    'speaker': '\u{1F50A}',
    'earpiece': '\u{1F4F1}',
  };

  const isDanger = variant === 'danger';

  const handlePress = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Haptics not available
    }
    onPress();
  };

  return (
    <TouchableOpacity
      style={[
        styles.controlButton,
        isDanger && styles.controlButtonDanger,
        !isDanger && !active && styles.controlButtonInactive,
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Text style={styles.controlIcon}>
        {iconMap[icon] || '?'}
      </Text>
      <Text style={[styles.controlLabel, isDanger && styles.controlLabelDanger]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ---- Helpers ----

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111111',
  },
  remoteVideoPlaceholder: {
    color: '#444444',
    fontSize: 24,
    fontWeight: '600',
  },
  reconnectingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  reconnectingText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '500',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  topBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  topRight: {
    alignItems: 'flex-end',
  },
  companionName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginRight: 8,
    maxWidth: SCREEN_WIDTH * 0.5,
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  duration: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  tokenCost: {
    color: '#FF6B00',
    fontSize: 12,
    marginTop: 2,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  controlButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 72,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  controlButtonDanger: {
    backgroundColor: '#FF3B30',
  },
  controlButtonInactive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  controlIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  controlLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '500',
  },
  controlLabelDanger: {
    color: '#FFFFFF',
  },
  errorOverlay: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorIcon: {
    color: '#FF3B30',
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 16,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorMessage: {
    color: '#999999',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  errorButton: {
    backgroundColor: '#FF6B00',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
