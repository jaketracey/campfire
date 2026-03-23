import type { EmotionalState } from '@/lib/api/imagegen';
import type { MessageSegment } from './types';

// ── Timestamp & date separator helpers ──

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isYesterday(date: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Returns a human-readable date label for the separator pill. */
export function dateSeparatorLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Returns true when a date separator should be rendered before `current`
 * (i.e. it is the first message or belongs to a different calendar day than `previous`).
 */
export function shouldShowDateSeparator(
  current: Date,
  previous: Date | null,
): boolean {
  if (!previous) return true;
  return !isSameDay(current, previous);
}

/** Formats a message timestamp: time-only for today, date + time for older. */
export function formatMessageTime(date: Date): string {
  if (isToday(date)) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Parse message content into action and dialogue segments
export function parseMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];

  // Handle null/undefined content
  if (!content) {
    return segments;
  }

  const regex = /\*([^*]+)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add dialogue before the action (if any)
    if (match.index > lastIndex) {
      const dialogue = content.slice(lastIndex, match.index).trim();
      if (dialogue) {
        segments.push({ type: 'dialogue', content: dialogue });
      }
    }
    // Add the action
    segments.push({ type: 'action', content: match[1].trim() });
    lastIndex = regex.lastIndex;
  }

  // Add remaining dialogue after the last action
  if (lastIndex < content.length) {
    const dialogue = content.slice(lastIndex).trim();
    if (dialogue) {
      segments.push({ type: 'dialogue', content: dialogue });
    }
  }

  // If no segments found, return the whole content as dialogue
  if (segments.length === 0) {
    segments.push({ type: 'dialogue', content: content.trim() });
  }

  return segments;
}

// Simple emotional state detection based on message content
export function detectEmotionalState(content: string): EmotionalState {
  const lowerContent = content.toLowerCase();

  if (lowerContent.match(/\b(happy|great|wonderful|excited|amazing|love|joy)\b/)) {
    return 'happy';
  }
  if (lowerContent.match(/\b(curious|wonder|how|why|what|tell me|explain)\b/)) {
    return 'curious';
  }
  if (lowerContent.match(/\b(excited|can't wait|thrilling|awesome)\b/)) {
    return 'excited';
  }
  if (lowerContent.match(/\b(think|consider|perhaps|maybe|ponder)\b/)) {
    return 'thoughtful';
  }
  if (lowerContent.match(/\b(here for you|understand|feel|sorry|help)\b/)) {
    return 'supportive';
  }
  if (lowerContent.match(/\b(haha|lol|funny|joke|play|fun)\b/)) {
    return 'playful';
  }
  if (lowerContent.match(/\b(calm|peace|relax|breathe|gentle)\b/)) {
    return 'calm';
  }

  return 'neutral';
}

// Extract scene/action description from LLM response for image generation
export function extractSceneDescription(content: string): string | undefined {
  // Look for action markers like *action* or (action)
  const actionMatch = content.match(/\*([^*]+)\*/);
  if (actionMatch) {
    return actionMatch[1];
  }

  // Look for parenthetical descriptions
  const parenMatch = content.match(/\(([^)]+)\)/);
  if (parenMatch) {
    return parenMatch[1];
  }

  // Take the first sentence and extract key visual elements
  const firstSentence = content.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length < 100) {
    // Look for visual/action verbs
    const visualMatch = firstSentence.match(/\b(smil|laugh|grin|look|gaz|lean|sit|stand|walk|danc|hug|wav|wink|blush|sigh)\w*/i);
    if (visualMatch) {
      return firstSentence.trim();
    }
  }

  return undefined;
}
