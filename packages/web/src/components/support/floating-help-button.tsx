'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SupportModal } from '@/components/support/support-modal';

export function FloatingHelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setOpen(true)}
              className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-black/60 border border-white/10 text-white/80 shadow-lg backdrop-blur-sm transition-all hover:bg-black/80 hover:text-white hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-campfire-500 focus:ring-offset-2 focus:ring-offset-background"
              aria-label="Get Help"
            >
              <HelpCircle className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8}>
            Get Help
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <SupportModal open={open} onOpenChange={setOpen} />
    </>
  );
}
