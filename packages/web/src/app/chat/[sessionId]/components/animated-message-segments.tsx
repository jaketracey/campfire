'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LikeButton } from '@/components/likes';
import type { MessageSegment } from '../types';

interface AnimatedMessageSegmentsProps {
  segments: MessageSegment[];
  isUser: boolean;
  messageId: string;
  showLikeButton?: boolean;
  likeCount?: number;
  onLike?: (id: string) => void;
  isNewMessage?: boolean;
  onSegmentReveal?: () => void;
}

export function AnimatedMessageSegments({
  segments,
  isUser,
  messageId,
  showLikeButton,
  likeCount,
  onLike,
  isNewMessage = false,
  onSegmentReveal,
}: AnimatedMessageSegmentsProps) {
  // Track how many action segments are visible (only actions stagger, only for new messages)
  const actionSegments = segments.filter((s) => s.type === 'action');
  const [visibleActionCount, setVisibleActionCount] = useState(isNewMessage ? 1 : actionSegments.length);

  // Progressively reveal action segments (only for new messages)
  useEffect(() => {
    if (!isNewMessage || visibleActionCount >= actionSegments.length) return;

    const timer = setTimeout(() => {
      setVisibleActionCount((prev) => prev + 1);
      onSegmentReveal?.();
    }, 1500);

    return () => clearTimeout(timer);
  }, [visibleActionCount, actionSegments.length, isNewMessage, onSegmentReveal]);

  // Find the last dialogue segment for the like button
  const lastDialogueIndex = segments.reduceRight(
    (acc, seg, idx) => (acc === -1 && seg.type === 'dialogue' ? idx : acc),
    -1
  );

  // Show segments progressively for new messages
  // Reveal action + everything after it until the next action
  let visibleSegments: MessageSegment[];

  if (!isNewMessage) {
    // Historical messages: show everything
    visibleSegments = segments;
  } else {
    // Find the index of the next unrevealed action
    let actionCount = 0;
    let cutoffIdx = segments.length;

    for (let i = 0; i < segments.length; i++) {
      if (segments[i].type === 'action') {
        actionCount++;
        if (actionCount > visibleActionCount) {
          // This action is not yet revealed - cut off here
          cutoffIdx = i;
          break;
        }
      }
    }

    visibleSegments = segments.slice(0, cutoffIdx);
  }

  // Group consecutive actions together
  const groupedSegments: { type: 'actions' | 'dialogue'; items: MessageSegment[]; startIndex: number }[] = [];
  let currentGroup: { type: 'actions' | 'dialogue'; items: MessageSegment[]; startIndex: number } | null = null;

  visibleSegments.forEach((segment, index) => {
    const groupType = segment.type === 'action' ? 'actions' : 'dialogue';
    if (!currentGroup || currentGroup.type !== groupType) {
      currentGroup = { type: groupType, items: [segment], startIndex: index };
      groupedSegments.push(currentGroup);
    } else {
      currentGroup.items.push(segment);
    }
  });

  // Track shimmer state for each action pill
  const [shimmerIndex, setShimmerIndex] = useState(0);

  // Stagger shimmer through action pills when new message
  useEffect(() => {
    if (!isNewMessage || actionSegments.length === 0) return;

    const timer = setInterval(() => {
      setShimmerIndex((prev) => {
        if (prev >= actionSegments.length - 1) {
          clearInterval(timer);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);

    return () => clearInterval(timer);
  }, [isNewMessage, actionSegments.length]);

  // Get action index for shimmer tracking
  const getActionIndex = (startIndex: number, itemIndex: number) => {
    return segments.slice(0, startIndex + itemIndex + 1).filter(s => s.type === 'action').length - 1;
  };

  return (
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} max-w-[80%]`}>
      {groupedSegments.map((group) => (
        <div
          key={`${messageId}-group-${group.startIndex}`}
          className={group.type === 'actions' ? 'flex flex-wrap gap-1.5' : ''}
        >
          {group.type === 'actions' ? (
            <AnimatePresence mode="popLayout">
              {group.items.map((segment, i) => {
                const actionIdx = getActionIndex(group.startIndex, i);
                const isShimmering = isNewMessage && actionIdx === shimmerIndex;
                return (
                  <motion.span
                    key={`${messageId}-${group.startIndex + i}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="inline-flex px-3 py-1.5 rounded-xl bg-muted/60 overflow-hidden relative"
                  >
                    <span className="text-xs text-campfire-400/80 whitespace-nowrap relative z-10">
                      {segment.content}
                    </span>
                    {isShimmering && (
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-campfire-400/30 to-transparent"
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ duration: 0.6, ease: 'easeInOut' }}
                      />
                    )}
                  </motion.span>
                );
              })}
            </AnimatePresence>
          ) : (
            group.items.map((segment, i) => {
              const actualIndex = group.startIndex + i;
              return (
                <span
                  key={`${messageId}-${actualIndex}`}
                  className={`inline-flex px-3 py-1.5 rounded-xl ${
                    isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <span className="text-base lg:text-sm whitespace-pre-wrap break-words">{segment.content}</span>
                  {showLikeButton && actualIndex === lastDialogueIndex && onLike && (
                    <span className="ml-2 -mr-1">
                      <LikeButton
                        turnId={messageId}
                        initialCount={likeCount || 0}
                        onLike={onLike}
                      />
                    </span>
                  )}
                </span>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}
