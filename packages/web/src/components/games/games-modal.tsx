'use client';

import { motion } from 'framer-motion';
import { Gamepad2, Grid3X3, Crown, CircleDot } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface Game {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
}

const AVAILABLE_GAMES: Game[] = [
  {
    id: 'tic_tac_toe',
    name: 'Tic-Tac-Toe',
    description: 'Classic 3x3 grid game. Get three in a row to win!',
    icon: <Grid3X3 className="h-8 w-8" />,
    available: true,
  },
  {
    id: 'chess',
    name: 'Chess',
    description: 'The classic game of strategy. Checkmate your companion!',
    icon: <Crown className="h-8 w-8" />,
    available: false, // Coming soon
  },
  {
    id: 'connect_four',
    name: 'Connect Four',
    description: 'Drop pieces to connect four in a row.',
    icon: <CircleDot className="h-8 w-8" />,
    available: false, // Coming soon
  },
];

interface GamesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGame: (gameType: string) => void;
  companionName?: string;
}

export function GamesModal({ isOpen, onClose, onSelectGame, companionName = 'your companion' }: GamesModalProps) {
  const handleGameSelect = (game: Game) => {
    if (!game.available) return;
    onSelectGame(game.id);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-background/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-primary" />
            Play a Game
          </DialogTitle>
          <DialogDescription>
            Challenge {companionName} to a game! Select one to start playing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {AVAILABLE_GAMES.map((game) => (
            <motion.button
              key={game.id}
              whileHover={game.available ? { scale: 1.02 } : {}}
              whileTap={game.available ? { scale: 0.98 } : {}}
              onClick={() => handleGameSelect(game)}
              disabled={!game.available}
              className={`
                w-full p-4 rounded-lg border text-left transition-colors
                ${game.available
                  ? 'border-border/50 hover:border-primary/50 hover:bg-primary/5 cursor-pointer'
                  : 'border-border/30 opacity-50 cursor-not-allowed'
                }
              `}
            >
              <div className="flex items-center gap-4">
                <div className={`
                  p-2 rounded-lg
                  ${game.available ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}
                `}>
                  {game.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{game.name}</span>
                    {!game.available && (
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                        Coming Soon
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {game.description}
                  </p>
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
