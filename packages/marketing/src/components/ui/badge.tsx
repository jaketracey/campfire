import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default:
          'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
        secondary:
          'bg-surface-tertiary text-text-secondary',
        outline:
          'border border-border text-text-secondary',
        success:
          'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
        warning:
          'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
        error:
          'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
