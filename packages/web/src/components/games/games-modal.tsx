'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, Gamepad2, Grid3X3, Crown, CircleDot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

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
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Card className="relative w-full max-w-md bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <Gamepad2 className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Play a Game</h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Content */}
              <div className="p-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Challenge {companionName} to a game! Select one to start playing.
                </p>

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
              </div>
            </Card>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
