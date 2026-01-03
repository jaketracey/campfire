'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Clock, MessageCircle, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

interface RecentSession {
  id: string;
  companionId: string;
  companionName: string;
  companionAvatarUrl: string | null;
  companionImageUrl: string | null; // Latest conversation image or anchor image
  lastMessage: string;
  updatedAt: string;
}

interface ContinueConversationProps {
  sessions: RecentSession[];
  maxSessions?: number;
}

/**
 * Format relative time (e.g., "2 hours ago", "3 days ago")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  } else if (diffWeeks < 4) {
    return `${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`;
  } else {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}

export function ContinueConversation({ sessions, maxSessions = 3 }: ContinueConversationProps) {
  const router = useRouter();
  const recentSessions = sessions.slice(0, maxSessions);

  // Mobile slider state for drag scrolling
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeft(scrollContainerRef.current.scrollLeft);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    scrollContainerRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // Don't render if no sessions
  if (recentSessions.length === 0) {
    return null;
  }

  const handleContinue = (sessionId: string) => {
    router.push(`/chat/${sessionId}`);
  };

  // Primary session (most recent)
  const primarySession = recentSessions[0];
  // Secondary sessions (2nd and 3rd most recent)
  const secondarySessions = recentSessions.slice(1);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="space-y-4"
    >
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <h2 className="text-xl font-bold font-display text-white">
          Continue where you left off
        </h2>
      </div>

      {/* Mobile: Horizontal slider with companion-style cards */}
      <div
        ref={scrollContainerRef}
        className={`md:hidden -mx-4 px-4 pb-4 overflow-x-auto scrollbar-hide ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex gap-4" style={{ width: 'max-content' }}>
          {recentSessions.map((session, idx) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="w-[75vw] flex-shrink-0"
            >
              <Card
                className="group relative overflow-hidden bg-white/[0.01] backdrop-blur-3xl border border-campfire-500/20 hover:border-campfire-500/40 transition-all duration-500 shadow-2xl h-full"
                onClick={() => handleContinue(session.id)}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-campfire-500/5 to-transparent pointer-events-none" />
                <CardContent className="p-0">
                  <div className="aspect-[2/3] relative overflow-hidden">
                    {(session.companionImageUrl || session.companionAvatarUrl) ? (
                      <img
                        src={session.companionImageUrl || session.companionAvatarUrl || ''}
                        alt={session.companionName}
                        className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-campfire-500/20 to-campfire-600/10 flex items-center justify-center">
                        <MessageCircle className="h-16 w-16 text-campfire-500/50" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

                    {/* Time badge */}
                    <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/50 backdrop-blur-sm border border-white/10 z-10">
                      <span className="flex items-center gap-1 text-[10px] text-white/70 font-medium">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(session.updatedAt)}
                      </span>
                    </div>

                    {/* Companion name - hidden on hover */}
                    <div className="absolute bottom-4 left-4 right-4 z-10 group-hover:opacity-0 transition-opacity duration-200">
                      <h3 className="text-xl font-bold text-white truncate">{session.companionName}</h3>
                      <p className={`text-white/60 text-sm truncate ${session.lastMessage !== 'Start chatting...' ? 'italic' : ''}`}>
                        {session.lastMessage !== 'Start chatting...' ? `"${session.lastMessage}"` : session.lastMessage}
                      </p>
                    </div>

                    {/* Hover action button */}
                    <div className="absolute bottom-4 left-4 right-4 z-20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleContinue(session.id);
                        }}
                        className="w-full h-10 rounded-xl bg-campfire-600 hover:bg-campfire-500 text-white font-bold"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Resume
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Desktop: Original layout */}
      <div className="hidden md:block space-y-3">
        {/* Primary card - featured most recent session */}
        <Card
          className="group cursor-pointer overflow-hidden bg-gradient-to-br from-campfire-500/10 via-white/[0.02] to-campfire-600/5 border border-campfire-500/20 hover:border-campfire-500/40 transition-all duration-300 shadow-[0_0_30px_rgba(234,88,12,0.1)] hover:shadow-[0_0_40px_rgba(234,88,12,0.2)]"
          onClick={() => handleContinue(primarySession.id)}
        >
          <CardContent className="p-0">
            <div className="flex flex-row">
              {/* Avatar section */}
              <div className="relative w-48 aspect-square flex-shrink-0 overflow-hidden">
                {(primarySession.companionImageUrl || primarySession.companionAvatarUrl) ? (
                  <img
                    src={primarySession.companionImageUrl || primarySession.companionAvatarUrl || ''}
                    alt={primarySession.companionName}
                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-campfire-500/20 to-campfire-600/10 flex items-center justify-center">
                    <MessageCircle className="h-12 w-12 text-campfire-500/50" />
                  </div>
                )}
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-zinc-950/80" />
              </div>

              {/* Content section */}
              <div className="flex-1 p-6 flex flex-col justify-center gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl font-bold font-display text-white group-hover:text-campfire-400 transition-colors">
                      {primarySession.companionName}
                    </h3>
                    <span className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(primarySession.updatedAt)}
                    </span>
                  </div>
                  <p className={`text-gray-400 text-base line-clamp-2 leading-relaxed ${primarySession.lastMessage !== 'Start chatting...' ? 'italic' : ''}`}>
                    {primarySession.lastMessage !== 'Start chatting...' ? `"${primarySession.lastMessage}"` : primarySession.lastMessage}
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <Button
                    className="h-11 px-6 rounded-full bg-campfire-600 hover:bg-campfire-500 text-white font-bold shadow-[0_0_15px_rgba(234,88,12,0.3)] hover:shadow-[0_0_25px_rgba(234,88,12,0.5)] transition-all group/btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleContinue(primarySession.id);
                    }}
                  >
                    Continue chatting
                    <ArrowRight className="h-4 w-4 ml-1 group-hover/btn:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Secondary sessions - compact row */}
        {secondarySessions.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {secondarySessions.map((session, idx) => (
              <motion.div
                key={session.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + idx * 0.1 }}
              >
                <Card
                  className="group cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 transition-all duration-300"
                  onClick={() => handleContinue(session.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Avatar */}
                      <Avatar className="h-12 w-12 border border-white/10 flex-shrink-0">
                        <AvatarImage
                          src={session.companionImageUrl || session.companionAvatarUrl || undefined}
                          alt={session.companionName}
                          className="object-cover"
                        />
                        <AvatarFallback className="bg-white/5 text-white/40">
                          <MessageCircle className="h-5 w-5" />
                        </AvatarFallback>
                      </Avatar>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-bold text-white font-display truncate group-hover:text-campfire-400 transition-colors">
                            {session.companionName}
                          </h4>
                          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium flex-shrink-0">
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                        </div>
                        <p className={`text-xs text-gray-500 line-clamp-1 ${session.lastMessage !== 'Start chatting...' ? 'italic' : ''}`}>
                          {session.lastMessage !== 'Start chatting...' ? `"${session.lastMessage}"` : session.lastMessage}
                        </p>
                      </div>

                      {/* Arrow indicator */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-4 w-4 text-campfire-500" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
