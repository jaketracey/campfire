'use client';

import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Gift, Heart } from 'lucide-react';
import type { GiftData } from '../types';

interface GiftMessageProps {
  giftData: GiftData;
  isNew?: boolean;
}

export function GiftMessage({ giftData, isNew }: GiftMessageProps) {
  return (
    <motion.div
      initial={isNew ? { opacity: 0, scale: 0.95 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex justify-end"
    >
      <Card
        className="max-w-[80%] p-4 bg-gradient-to-br from-campfire-500/10 to-pink-500/10 border-campfire-500/30"
        role="article"
        aria-label={`Gift sent: ${giftData.name}`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-3 text-campfire-500">
          <Gift className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-medium uppercase tracking-wide">Gift Sent</span>
        </div>

        {/* Gift Content */}
        <div className="flex items-start gap-3">
          {/* Gift Image */}
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0">
            {giftData.imageUrl ? (
              <img
                src={giftData.imageUrl}
                alt={`Gift: ${giftData.name}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div
                className="w-full h-full bg-gradient-to-br from-campfire-400 to-campfire-600 flex items-center justify-center"
                role="img"
                aria-label="Gift icon"
              >
                <span className="text-2xl" aria-hidden="true">🎁</span>
              </div>
            )}
          </div>

          {/* Gift Details */}
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm">{giftData.name}</h4>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {giftData.description}
            </p>
            {giftData.emotionalMeaning && (
              <div className="flex items-center gap-1 mt-2 text-xs text-pink-500/80">
                <Heart className="h-3 w-3" aria-hidden="true" />
                <span className="italic line-clamp-1">{giftData.emotionalMeaning}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
