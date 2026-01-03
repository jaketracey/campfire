'use client';

import { Button } from '@/components/ui/button';
import { Phone, Sparkles, BookOpen, Gamepad2, Gift, Users } from 'lucide-react';
import type { CompanionBackstory } from '@/lib/api';
import type { SignupTrigger } from '@/components/demo/signup-modal';

interface MobileActionBarProps {
  backstoryData: CompanionBackstory | null;
  isCallActive: boolean;
  onCallClick: () => void;
  onShowPersonality: () => void;
  onShowBackstory: () => void;
  onShowGames: () => void;
  onShowGifts: () => void;
  onShowFriends: () => void;

  // Demo mode
  isDemo?: boolean;
  onRequireAuth?: (trigger: SignupTrigger) => void;
}

export function MobileActionBar({
  backstoryData,
  isCallActive,
  onCallClick,
  onShowPersonality,
  onShowBackstory,
  onShowGames,
  onShowGifts,
  onShowFriends,
  isDemo,
  onRequireAuth,
}: MobileActionBarProps) {
  const handleDemoGuard = (action: SignupTrigger, callback: () => void) => {
    if (isDemo && onRequireAuth) {
      onRequireAuth(action);
    } else {
      callback();
    }
  };

  return (
    <div className="lg:hidden pb-3 -mx-6 px-6 overflow-x-auto scrollbar-hide">
      <div className="flex gap-2 w-max">
        <Button
          variant="outline"
          className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-emerald-700/30 text-emerald-500 hover:bg-emerald-900/20 hover:text-emerald-400"
          onClick={onCallClick}
          disabled={isCallActive}
        >
          <Phone className="h-4 w-4" />
          <span className="text-sm">Call</span>
        </Button>

        <Button
          variant="outline"
          className="flex-shrink-0 gap-2 px-4 py-3 h-auto"
          onClick={() => handleDemoGuard('personality', onShowPersonality)}
        >
          <Sparkles className="h-4 w-4" />
          <span className="text-sm">Personality</span>
        </Button>

        {backstoryData?.hasBackstory && (
          <Button
            variant="outline"
            className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-amber-700/30 text-amber-500 hover:bg-amber-900/20 hover:text-amber-400"
            onClick={() => handleDemoGuard('avatar', onShowBackstory)}
          >
            <BookOpen className="h-4 w-4" />
            <span className="text-sm">Backstory</span>
          </Button>
        )}

        <Button
          variant="outline"
          className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-cyan-700/30 text-cyan-500 hover:bg-cyan-900/20 hover:text-cyan-400"
          onClick={() => handleDemoGuard('games', onShowGames)}
        >
          <Gamepad2 className="h-4 w-4" />
          <span className="text-sm">Games</span>
        </Button>

        <Button
          variant="outline"
          className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-rose-700/30 text-rose-500 hover:bg-rose-900/20 hover:text-rose-400"
          onClick={() => handleDemoGuard('gifts', onShowGifts)}
        >
          <Gift className="h-4 w-4" />
          <span className="text-sm">Gifts</span>
        </Button>

        <Button
          variant="outline"
          className="flex-shrink-0 gap-2 px-4 py-3 h-auto border-purple-700/30 text-purple-500 hover:bg-purple-900/20 hover:text-purple-400"
          onClick={() => handleDemoGuard('friends', onShowFriends)}
        >
          <Users className="h-4 w-4" />
          <span className="text-sm">Friends</span>
        </Button>
      </div>
    </div>
  );
}
