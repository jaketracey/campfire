import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Animated,
  Dimensions,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MINI_WIDTH = 120;
const MINI_HEIGHT = 160;
const EDGE_PADDING = 12;

interface MiniVideoCallProps {
  companionName: string;
  duration: number;
  /** Expand to full screen */
  onExpand: () => void;
  /** End the call from the mini view */
  onEndCall: () => void;
}

/**
 * Minimized floating video view (picture-in-picture style).
 *
 * Draggable around the screen edges. Shows the companion name and call
 * duration. Tap to expand back to full screen.
 */
export function MiniVideoCall({
  companionName,
  duration,
  onExpand,
  onEndCall,
}: MiniVideoCallProps): React.JSX.Element {
  const pan = useRef(
    new Animated.ValueXY({
      x: SCREEN_WIDTH - MINI_WIDTH - EDGE_PADDING,
      y: SCREEN_HEIGHT * 0.15,
    })
  ).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only capture if user is dragging, not just tapping
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderMove: (_event, gestureState) => {
        // Clamp position to screen bounds
        const x = Math.max(
          EDGE_PADDING,
          Math.min(gestureState.moveX - MINI_WIDTH / 2, SCREEN_WIDTH - MINI_WIDTH - EDGE_PADDING)
        );
        const y = Math.max(
          EDGE_PADDING + 50, // account for status bar
          Math.min(gestureState.moveY - MINI_HEIGHT / 2, SCREEN_HEIGHT - MINI_HEIGHT - EDGE_PADDING)
        );
        pan.setValue({ x, y });
      },
      onPanResponderRelease: (_, gestureState) => {
        // Snap to nearest horizontal edge
        const currentX = gestureState.moveX - MINI_WIDTH / 2;
        const snapX =
          currentX < SCREEN_WIDTH / 2
            ? EDGE_PADDING
            : SCREEN_WIDTH - MINI_WIDTH - EDGE_PADDING;

        Animated.spring(pan.x, {
          toValue: snapX,
          useNativeDriver: false,
          friction: 7,
        }).start();
      },
    })
  ).current;

  const formattedDuration = formatDuration(duration);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          left: pan.x,
          top: pan.y,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={styles.content}
        onPress={onExpand}
        activeOpacity={0.9}
      >
        {/* Video placeholder */}
        <View style={styles.videoPlaceholder}>
          <Text style={styles.avatarLetter}>
            {companionName.charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Duration overlay */}
        <View style={styles.durationOverlay}>
          <Text style={styles.durationText}>{formattedDuration}</Text>
        </View>

        {/* End call mini button */}
        <TouchableOpacity style={styles.endButton} onPress={onEndCall}>
          <Text style={styles.endButtonIcon}>{'\u{1F4DE}'}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    zIndex: 100,
  },
  content: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333333',
  },
  videoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    color: '#FF6B00',
    fontSize: 32,
    fontWeight: '700',
  },
  durationOverlay: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  endButton: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  endButtonIcon: {
    fontSize: 12,
  },
});
