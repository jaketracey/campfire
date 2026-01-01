import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <Flame className={cn('text-brand-500', className)} />
  );
}
